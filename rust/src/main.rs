mod protocol;

use anyhow::{bail, Context, Result};
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use protocol::{parse_action, Action};
use std::env;
use std::time::Duration;
use tokio::time::{self, Instant};
use uuid::Uuid;

const DEVICE_NAME: &str = "极梦匠";
const SERVICE_UUID: Uuid = Uuid::from_u128(0x0000fff0_0000_1000_8000_00805f9b34fb);
const WRITE_UUID: Uuid = Uuid::from_u128(0x0000fff3_0000_1000_8000_00805f9b34fb);
const NOTIFY_UUID: Uuid = Uuid::from_u128(0x0000fff4_0000_1000_8000_00805f9b34fb);
const SCAN_TIME: Duration = Duration::from_secs(8);
const CONNECT_TIME: Duration = Duration::from_secs(15);
const OPERATION_TIME: Duration = Duration::from_secs(10);
const NOTIFY_TIME: Duration = Duration::from_secs(5);

fn hex_bytes(data: &[u8]) -> String {
    data.iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn usage() -> &'static str {
    "usage: model-light-ble <CoreBluetooth-UUID> scan|read <40|30|50>|preview <white|red>|point <0..22>"
}

async fn find_device(expected_id: Uuid) -> Result<Peripheral> {
    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    if adapters.is_empty() {
        bail!("no Bluetooth adapter found");
    }

    for adapter in adapters {
        adapter.start_scan(ScanFilter::default()).await?;
        time::sleep(SCAN_TIME).await;
        let peripherals_result = adapter.peripherals().await;
        let stop_result = adapter.stop_scan().await;
        let peripherals = peripherals_result?;
        stop_result?;

        for peripheral in peripherals {
            // On macOS, btleplug's PeripheralId displays the CoreBluetooth UUID.
            let id: Uuid = peripheral.id().to_string().parse()?;
            if id != expected_id {
                continue;
            }
            let properties = peripheral
                .properties()
                .await?
                .context("matching device has no advertising properties")?;
            let name_matches = properties.local_name.as_deref() == Some(DEVICE_NAME)
                || properties.advertisement_name.as_deref() == Some(DEVICE_NAME);
            if !name_matches {
                bail!("device ID matched, but advertised name was not {DEVICE_NAME}; refusing connection");
            }
            println!(
                "matched name={DEVICE_NAME} id={id} rssi={:?}",
                properties.rssi
            );
            return Ok(peripheral);
        }
    }
    bail!("no device matched both name {DEVICE_NAME} and the supplied CoreBluetooth UUID")
}

fn checked_characteristics(peripheral: &Peripheral) -> Result<(Characteristic, Characteristic)> {
    let services = peripheral.services();
    let service = services
        .iter()
        .find(|service| service.uuid == SERVICE_UUID)
        .context("FFF0 service missing; no command sent")?;
    let writer = service
        .characteristics
        .iter()
        .find(|char_| char_.uuid == WRITE_UUID && char_.service_uuid == SERVICE_UUID)
        .context("FFF3 characteristic is not in FFF0; no command sent")?;
    if !writer
        .properties
        .contains(CharPropFlags::WRITE_WITHOUT_RESPONSE)
    {
        bail!("FFF3 does not allow write-without-response; no command sent");
    }
    let receiver = service
        .characteristics
        .iter()
        .find(|char_| char_.uuid == NOTIFY_UUID && char_.service_uuid == SERVICE_UUID)
        .context("FFF4 characteristic is not in FFF0; no command sent")?;
    if !receiver.properties.contains(CharPropFlags::NOTIFY) {
        bail!("FFF4 does not allow notifications; no command sent");
    }
    Ok((writer.clone(), receiver.clone()))
}

async fn run_command(peripheral: &Peripheral, action: Action) -> Result<()> {
    let mut subscribed = false;
    let mut notify_characteristic: Option<Characteristic> = None;
    let operation = async {
        peripheral.connect_with_timeout(CONNECT_TIME).await?;
        println!("connected");
        peripheral.discover_services_with_timeout(CONNECT_TIME).await?;
        let (writer, receiver) = checked_characteristics(peripheral)?;
        println!("verified FFF0 / FFF3 write-without-response / FFF4 notify");

        let mut notifications = time::timeout(OPERATION_TIME, peripheral.notifications()).await??;
        time::timeout(OPERATION_TIME, peripheral.subscribe(&receiver)).await??;
        subscribed = true;
        notify_characteristic = Some(receiver);
        println!("subscribed FFF4");

        let request = action.frame();
        println!("TX {}", hex_bytes(&request));
        time::timeout(OPERATION_TIME,
            peripheral.write(&writer, &request, WriteType::WithoutResponse)).await??;
        println!("write API completed; device acceptance requires observation");

        let deadline = Instant::now() + NOTIFY_TIME;
        loop {
            tokio::select! {
                _ = time::sleep_until(deadline) => break,
                signal = tokio::signal::ctrl_c() => {
                    signal?;
                    println!("interrupted; closing BLE session");
                    break;
                }
                item = notifications.next() => match item {
                    Some(notification) => println!("RX {} {}", notification.uuid, hex_bytes(&notification.value)),
                    None => break,
                },
            }
        }
        Ok::<(), anyhow::Error>(())
    }.await;

    // Cleanup is attempted even if service discovery, subscribe, write, or notification handling fails.
    let unsubscribe = if subscribed {
        let receiver = notify_characteristic.as_ref().expect("set when subscribed");
        time::timeout(OPERATION_TIME, peripheral.unsubscribe(receiver))
            .await
            .map_err(anyhow::Error::from)
            .and_then(|result| result.map_err(anyhow::Error::from))
    } else {
        Ok(())
    };
    let disconnect = time::timeout(OPERATION_TIME, peripheral.disconnect())
        .await
        .map_err(anyhow::Error::from)
        .and_then(|result| result.map_err(anyhow::Error::from));
    if subscribed {
        println!(
            "unsubscribe FFF4: {}",
            if unsubscribe.is_ok() { "ok" } else { "failed" }
        );
    }
    println!(
        "disconnect: {}",
        if disconnect.is_ok() { "ok" } else { "failed" }
    );
    operation?;
    unsubscribe?;
    disconnect?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let id_text = args.next().context(usage())?;
    let expected_id: Uuid = id_text.parse().context("invalid CoreBluetooth UUID")?;
    let command_parts: Vec<String> = args.collect();
    let action = parse_action(&command_parts).context(usage())?;
    let peripheral = find_device(expected_id).await?;
    if let Some(action) = action {
        run_command(&peripheral, action).await?;
    }
    Ok(())
}
