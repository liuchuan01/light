use crate::{
    planner::{self, Step},
    protocol::*,
};
use anyhow::{bail, ensure, Context, Result};
use btleplug::{
    api::{
        Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter,
        WriteType,
    },
    platform::{Adapter, Manager, Peripheral},
};
use futures::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{broadcast, Mutex},
    task::JoinHandle,
    time::{sleep, timeout},
};
use uuid::Uuid;

const SERVICE: Uuid = Uuid::from_u128(0x0000fff0_0000_1000_8000_00805f9b34fb);
const WRITE: Uuid = Uuid::from_u128(0x0000fff3_0000_1000_8000_00805f9b34fb);
const NOTIFY: Uuid = Uuid::from_u128(0x0000fff4_0000_1000_8000_00805f9b34fb);
const OP_TIMEOUT: Duration = Duration::from_secs(10);
const DEVICE_NAME: &str = "极梦匠";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub timestamp: u128,
    pub kind: String,
    pub message: String,
    pub hex: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub device: Option<DeviceInfo>,
    pub inventory: Option<Inventory>,
    pub log_path: String,
}
struct Hub {
    events: broadcast::Sender<Event>,
    file: StdMutex<File>,
    path: String,
}
impl Hub {
    fn event(&self, kind: &str, message: impl Into<String>, bytes: Option<&[u8]>) {
        let event = Event {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            kind: kind.into(),
            message: message.into(),
            hex: bytes.map(hex),
        };
        if let Ok(mut file) = self.file.lock() {
            if let Ok(json) = serde_json::to_string(&event) {
                let _ = writeln!(file, "{json}");
            }
        }
        let _ = self.events.send(event);
    }
}
struct Session {
    peripheral: Peripheral,
    writer: Characteristic,
    receiver: Characteristic,
    frames: broadcast::Sender<Vec<u8>>,
    alive: Arc<AtomicBool>,
    notify_task: JoinHandle<()>,
    monitor_task: JoinHandle<()>,
    info: DeviceInfo,
}
impl Session {
    async fn close(self) {
        self.alive.store(false, Ordering::SeqCst);
        self.notify_task.abort();
        self.monitor_task.abort();
        let _ = timeout(OP_TIMEOUT, self.peripheral.unsubscribe(&self.receiver)).await;
        let _ = timeout(OP_TIMEOUT, self.peripheral.disconnect()).await;
    }
}
#[derive(Default)]
struct Inner {
    adapters: Vec<Adapter>,
    found: HashMap<String, (DeviceInfo, Peripheral)>,
    session: Option<Session>,
    inventory: Option<Inventory>,
}
pub struct Controller {
    inner: Mutex<Inner>,
    hub: Arc<Hub>,
}
impl Controller {
    pub fn new(log_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&log_dir)?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let path = log_dir.join(format!("ble-{stamp}-{}.jsonl", std::process::id()));
        let file = OpenOptions::new()
            .create_new(true)
            .append(true)
            .open(&path)?;
        let (events, _) = broadcast::channel(512);
        Ok(Self {
            inner: Mutex::new(Inner::default()),
            hub: Arc::new(Hub {
                events,
                file: StdMutex::new(file),
                path: path.display().to_string(),
            }),
        })
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.hub.events.subscribe()
    }
    fn status_of(&self, inner: &Inner) -> Status {
        let connected = inner
            .session
            .as_ref()
            .is_some_and(|s| s.alive.load(Ordering::SeqCst));
        Status {
            connected,
            device: inner.session.as_ref().map(|s| s.info.clone()),
            inventory: if connected {
                inner.inventory.clone()
            } else {
                None
            },
            log_path: self.hub.path.clone(),
        }
    }
    pub async fn status(&self) -> Status {
        self.status_of(&*self.inner.lock().await)
    }
    pub async fn scan(&self) -> Result<Vec<DeviceInfo>> {
        let mut inner = self.inner.lock().await;
        ensure!(
            !inner
                .session
                .as_ref()
                .is_some_and(|s| s.alive.load(Ordering::SeqCst)),
            "请先断开当前灯组再扫描"
        );
        inner.found.clear();
        self.hub.event("info", "开始扫描极梦匠灯组", None);
        if let Some(old) = inner.session.take() {
            old.close().await;
        }
        if inner.adapters.is_empty() {
            let manager = timeout(OP_TIMEOUT, Manager::new())
                .await
                .context("蓝牙管理器初始化超时")??;
            inner.adapters = timeout(OP_TIMEOUT, manager.adapters()).await??;
        }
        let adapters = inner.adapters.clone();
        ensure!(
            !adapters.is_empty(),
            "未发现蓝牙适配器，请检查蓝牙开关和系统授权"
        );
        for (adapter_index, adapter) in adapters.into_iter().enumerate() {
            let result = async {
                timeout(OP_TIMEOUT, adapter.start_scan(ScanFilter::default())).await??;
                sleep(Duration::from_secs(6)).await;
                let peripherals = timeout(OP_TIMEOUT, adapter.peripherals()).await??;
                for peripheral in peripherals {
                    let Some(properties) = timeout(OP_TIMEOUT, peripheral.properties()).await??
                    else {
                        continue;
                    };
                    if properties.local_name.as_deref() != Some(DEVICE_NAME)
                        && properties.advertisement_name.as_deref() != Some(DEVICE_NAME)
                    {
                        continue;
                    }
                    let id = format!("{adapter_index}:{}", peripheral.id());
                    let info = DeviceInfo {
                        id: id.clone(),
                        name: DEVICE_NAME.into(),
                        rssi: properties.rssi,
                    };
                    inner.found.insert(id, (info, peripheral));
                }
                Ok::<(), anyhow::Error>(())
            }
            .await;
            let stop = timeout(OP_TIMEOUT, adapter.stop_scan()).await;
            result?;
            stop??;
        }
        let mut devices: Vec<_> = inner.found.values().map(|(info, _)| info.clone()).collect();
        devices.sort_by(|a, b| a.id.cmp(&b.id));
        self.hub.event(
            "info",
            format!("扫描完成，找到 {} 台灯组", devices.len()),
            None,
        );
        Ok(devices)
    }
    pub async fn connect(&self, id: &str) -> Result<Status> {
        let mut inner = self.inner.lock().await;
        let (info, peripheral) = inner
            .found
            .get(id)
            .cloned()
            .context("设备不在扫描结果中，请重新扫描并选择")?;
        if let Some(old) = inner.session.take() {
            old.close().await;
        }
        inner.inventory = None;
        self.hub
            .event("info", format!("连接 {} ({})", info.name, info.id), None);
        let result = self.open(peripheral.clone(), info).await;
        match result {
            Ok(session) => inner.session = Some(session),
            Err(error) => {
                let _ = timeout(OP_TIMEOUT, peripheral.disconnect()).await;
                self.hub
                    .event("disconnected", format!("连接失败：{error:#}"), None);
                return Err(error);
            }
        }
        let result = self.read_inventory(inner.session.as_ref().unwrap()).await;
        self.finish(&mut inner, result).await?;
        self.hub.event(
            "connected",
            "连接完成，FFF0/FFF3/FFF4 已核对，预设已读取",
            None,
        );
        Ok(self.status_of(&inner))
    }
    async fn open(&self, peripheral: Peripheral, info: DeviceInfo) -> Result<Session> {
        let properties = timeout(OP_TIMEOUT, peripheral.properties())
            .await??
            .context("设备没有广播属性")?;
        ensure!(
            properties.local_name.as_deref() == Some(DEVICE_NAME)
                || properties.advertisement_name.as_deref() == Some(DEVICE_NAME),
            "设备名称变化，取消连接"
        );
        timeout(Duration::from_secs(15), peripheral.connect())
            .await
            .context("连接超时")??;
        timeout(Duration::from_secs(15), peripheral.discover_services())
            .await
            .context("服务发现超时")??;
        let services = peripheral.services();
        let service = services
            .iter()
            .find(|s| s.uuid == SERVICE)
            .context("缺少 FFF0 服务")?;
        let writer = service
            .characteristics
            .iter()
            .find(|c| {
                c.uuid == WRITE
                    && c.service_uuid == SERVICE
                    && c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
            })
            .context("FFF3 不支持无响应写入")?
            .clone();
        let receiver = service
            .characteristics
            .iter()
            .find(|c| {
                c.uuid == NOTIFY
                    && c.service_uuid == SERVICE
                    && c.properties.contains(CharPropFlags::NOTIFY)
            })
            .context("FFF4 不支持通知")?
            .clone();
        let mut notifications = timeout(OP_TIMEOUT, peripheral.notifications()).await??;
        let (frames, _) = broadcast::channel(256);
        let sink = frames.clone();
        let alive = Arc::new(AtomicBool::new(true));
        let receiving = alive.clone();
        let hub = self.hub.clone();
        let notify_task = tokio::spawn(async move {
            let mut decoder = Decoder::default();
            while let Some(notification) = notifications.next().await {
                if notification.uuid != NOTIFY {
                    continue;
                }
                hub.event("rx", "FFF4 原始通知", Some(&notification.value));
                for frame in decoder.feed(&notification.value) {
                    let _ = sink.send(frame);
                }
            }
            if receiving.swap(false, Ordering::SeqCst) {
                hub.event("disconnected", "通知流结束，设备状态未知", None);
            }
        });
        let watching = alive.clone();
        let watcher = peripheral.clone();
        let hub = self.hub.clone();
        let monitor_task = tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(2)).await;
                if !watching.load(Ordering::SeqCst) {
                    break;
                }
                if !matches!(
                    timeout(OP_TIMEOUT, watcher.is_connected()).await,
                    Ok(Ok(true))
                ) {
                    if watching.swap(false, Ordering::SeqCst) {
                        hub.event("disconnected", "蓝牙连接已断开；未自动重连或重发", None);
                    }
                    break;
                }
            }
        });
        let session = Session {
            peripheral,
            writer,
            receiver,
            frames,
            alive,
            notify_task,
            monitor_task,
            info,
        };
        match timeout(OP_TIMEOUT, session.peripheral.subscribe(&session.receiver)).await {
            Ok(Ok(())) => Ok(session),
            result => {
                session.close().await;
                bail!("订阅 FFF4 失败：{result:?}");
            }
        }
    }
    async fn request(&self, session: &Session, packet: &[u8]) -> Result<Vec<u8>> {
        ensure!(
            session.alive.load(Ordering::SeqCst),
            "设备已断开，请重新连接"
        );
        let replies = session.frames.subscribe();
        self.hub
            .event("tx", format!("发送 {:02X}", packet[1]), Some(packet));
        crate::transport::exchange(packet, replies, |chunk| async move {
            session
                .peripheral
                .write(&session.writer, &chunk, WriteType::WithoutResponse)
                .await?;
            Ok(())
        })
        .await
    }

    async fn read_inventory(&self, session: &Session) -> Result<Inventory> {
        let mut out = Inventory::default();
        for slot in parse_list(&self.request(session, &query(0x40, None)?).await?, 0x40)? {
            out.whole.push(parse_whole(
                &self.request(session, &query(0x41, Some(slot))?).await?,
            )?);
        }
        for slot in parse_list(&self.request(session, &query(0x30, None)?).await?, 0x30)? {
            out.local.push(parse_local(
                &self.request(session, &query(0x31, Some(slot))?).await?,
            )?);
        }
        for slot in parse_list(&self.request(session, &query(0x50, None)?).await?, 0x50)? {
            let mut preset =
                parse_advanced(&self.request(session, &query(0x51, Some(slot))?).await?)?;
            preset.orders = parse_orders(
                &self.request(session, &query(0x52, Some(slot))?).await?,
                slot,
            )?;
            out.advanced.push(preset);
        }
        Ok(out)
    }
    async fn finish(&self, inner: &mut Inner, result: Result<Inventory>) -> Result<()> {
        match result {
            Ok(inventory) => {
                inner.inventory = Some(inventory);
                Ok(())
            }
            Err(error) => {
                let message =
                    format!("{error:#}。已断开，请重连读取实际状态；没有自动重发或回滚。");
                if let Some(session) = inner.session.take() {
                    session.close().await;
                }
                inner.inventory = None;
                self.hub.event("disconnected", &message, None);
                bail!(message)
            }
        }
    }
    pub async fn refresh(&self) -> Result<Status> {
        let mut inner = self.inner.lock().await;
        let session = inner.session.as_ref().context("请先连接灯组")?;
        let result = self.read_inventory(session).await;
        self.finish(&mut inner, result).await?;
        Ok(self.status_of(&inner))
    }
    pub async fn disconnect(&self) -> Result<()> {
        let mut inner = self.inner.lock().await;
        if let Some(session) = inner.session.take() {
            session.close().await;
        }
        inner.inventory = None;
        self.hub
            .event("disconnected", "已断开连接；已保存灯效可能继续播放", None);
        Ok(())
    }
    pub async fn preview(&self, scene: &Scene, points: &[u8]) -> Result<()> {
        let packet = preview(scene, points)?;
        let mut inner = self.inner.lock().await;
        let session = inner.session.as_ref().context("请先连接灯组")?;
        let result = self
            .request(session, &packet)
            .await
            .map(|_| inner.inventory.clone().unwrap_or_default());
        self.finish(&mut inner, result).await
    }
    async fn execute(&self, session: &Session, steps: &[Step]) -> Result<()> {
        for (index, step) in steps.iter().enumerate() {
            self.hub.event(
                "info",
                format!("执行步骤 {} / {}", index + 1, steps.len()),
                None,
            );
            self.request(session, &step.packet).await?;
            if let Some(readback) = &step.readback {
                let received = self.request(session, readback).await?;
                ensure!(
                    received[4..received.len() - 1] == step.packet[4..step.packet.len() - 1],
                    "{:02X} 保存后详情与请求不一致",
                    step.packet[1]
                );
            }
        }
        Ok(())
    }
    pub async fn activate(&self, scene: &Scene) -> Result<Status> {
        scene.validate()?;
        let mut inner = self.inner.lock().await;
        let session = inner.session.as_ref().context("请先连接灯组")?;
        let inventory = self.read_inventory(session).await;
        self.finish(&mut inner, inventory).await?;
        let plan = planner::compile(scene, inner.inventory.as_ref().unwrap())?; // No mutation on allocation failure.
        let session = inner.session.as_ref().unwrap();
        let result = async {
            self.execute(session, &plan.steps).await?;
            let inventory = self.read_inventory(session).await?;
            let active = if plan.advanced {
                inventory
                    .advanced
                    .iter()
                    .any(|p| p.slot == plan.target_slot && p.enabled)
            } else {
                inventory
                    .whole
                    .iter()
                    .any(|p| p.slot == plan.target_slot && p.enabled)
            };
            ensure!(active, "设备未回报目标预设已开启");
            ensure!(
                inventory.whole.iter().filter(|p| p.enabled).count()
                    + inventory.advanced.iter().filter(|p| p.enabled).count()
                    == 1,
                "设备仍报告多个预设开启，播放状态不明确"
            );
            Ok(inventory)
        }
        .await;
        self.finish(&mut inner, result).await?;
        Ok(self.status_of(&inner))
    }
    pub async fn stop(&self) -> Result<Status> {
        let mut inner = self.inner.lock().await;
        let session = inner.session.as_ref().context("请先连接灯组")?;
        let result = async {
            let inventory = self.read_inventory(session).await?;
            self.execute(session, &planner::stop_steps(&inventory)?)
                .await?;
            let inventory = self.read_inventory(session).await?;
            ensure!(
                !inventory.whole.iter().any(|p| p.enabled)
                    && !inventory.advanced.iter().any(|p| p.enabled),
                "设备仍报告开启状态"
            );
            Ok(inventory)
        }
        .await;
        self.finish(&mut inner, result).await?;
        Ok(self.status_of(&inner))
    }
}
