use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Light {
    pub color: String,
    pub brightness: u8,
    pub effect: u8,
}
impl Light {
    pub fn rgb(&self) -> Result<[u8; 3]> {
        ensure!(
            self.color.len() == 7
                && self.color.starts_with('#')
                && self.color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit),
            "RGB 必须为 #RRGGBB"
        );
        Ok([
            u8::from_str_radix(&self.color[1..3], 16)?,
            u8::from_str_radix(&self.color[3..5], 16)?,
            u8::from_str_radix(&self.color[5..7], 16)?,
        ])
    }
    pub fn validate(&self, local: bool) -> Result<()> {
        self.rgb()?;
        ensure!((1..=10).contains(&self.brightness), "当前亮度范围为 1–10");
        ensure!(
            self.effect <= if local { 2 } else { 10 },
            "该目标不支持此灯效编号"
        );
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Whole,
    Points,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub scope: Scope,
    pub light: Light,
    pub points: Vec<Light>,
    pub direction: u8,
    pub speed: u8,
}
impl Scene {
    pub fn slot(&self) -> Result<u8> {
        match self.id.as_str() {
            "scene-1" => Ok(0),
            "scene-2" => Ok(1),
            "scene-3" => Ok(2),
            "scene-4" => Ok(3),
            _ => bail!("场景编号无效"),
        }
    }
    pub fn validate(&self) -> Result<()> {
        self.slot()?;
        ensure!(self.points.len() == 23, "场景必须包含 23 个灯位");
        ensure!(
            self.direction <= 1 && self.speed <= 100,
            "方向或速度超出范围"
        );
        match self.scope {
            Scope::Whole => self.light.validate(false)?,
            Scope::Points => {
                for light in &self.points {
                    light.validate(true)?;
                }
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WholePreset {
    pub slot: u8,
    pub enabled: bool,
    pub color_type: u8,
    pub light: Light,
    pub direction: u8,
    pub speed: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPreset {
    pub slot: u8,
    pub points: Vec<u8>,
    pub color_type: u8,
    pub light: Light,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub index: u8,
    pub locals: Vec<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedPreset {
    pub slot: u8,
    pub enabled: bool,
    pub locals: Vec<u8>,
    pub mode: u8,
    pub direction: u8,
    pub speed: u8,
    pub step: u8,
    pub orders: Vec<Order>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Inventory {
    pub whole: Vec<WholePreset>,
    pub local: Vec<LocalPreset>,
    pub advanced: Vec<AdvancedPreset>,
}

pub fn frame(cmd: u8, write: bool, payload: &[u8]) -> Result<Vec<u8>> {
    ensure!(payload.len() <= 255, "报文过长");
    let mut out = vec![0xbc, cmd, u8::from(write), payload.len() as u8];
    out.extend(payload);
    out.push(0x55);
    Ok(out)
}
pub fn query(cmd: u8, slot: Option<u8>) -> Result<Vec<u8>> {
    match (cmd, slot) {
        (0x30 | 0x40 | 0x50, None) => frame(cmd, false, &[]),
        (0x31, Some(n)) if n < 14 => frame(cmd, false, &[n]),
        (0x41 | 0x51 | 0x52, Some(n)) if n < 4 => frame(cmd, false, &[n]),
        _ => bail!("不支持的读取命令"),
    }
}
pub fn whole_frame(
    cmd: u8,
    slot: u8,
    enabled: bool,
    light: &Light,
    direction: u8,
    speed: u8,
) -> Result<Vec<u8>> {
    ensure!(matches!(cmd, 0x42 | 0x43) && slot < 4, "全身命令或槽位无效");
    light.validate(false)?;
    ensure!(direction <= 1 && speed <= 100, "方向或速度无效");
    let [r, g, b] = light.rgb()?;
    // Direction/speed are not part of breathing/default scenes, even if retained in the editor.
    let (direction, speed) = if light.effect >= 3 {
        (direction, speed)
    } else {
        (0, 0)
    };
    frame(
        cmd,
        true,
        &[
            slot,
            u8::from(enabled && cmd == 0x43),
            0,
            r,
            g,
            b,
            light.brightness,
            light.effect,
            direction,
            speed,
        ],
    )
}
pub fn local_frame(cmd: u8, preset: &LocalPreset) -> Result<Vec<u8>> {
    ensure!(
        matches!(cmd, 0x32 | 0x33) && preset.slot < 14 && preset.color_type == 0,
        "局部命令或槽位无效"
    );
    valid_indices(&preset.points, 23, false)?;
    preset.light.validate(true)?;
    let mut data = vec![preset.slot, preset.points.len() as u8];
    data.extend(&preset.points);
    data.push(0);
    data.extend(preset.light.rgb()?);
    data.extend([preset.light.brightness, preset.light.effect]);
    frame(cmd, true, &data)
}
pub fn switch(cmd: u8, slot: u8, enabled: bool) -> Result<Vec<u8>> {
    ensure!(matches!(cmd, 0x44 | 0x56) && slot < 4, "开关命令或槽位无效");
    frame(cmd, true, &[slot, u8::from(enabled)])
}
pub fn advanced_frame(preset: &AdvancedPreset) -> Result<Vec<u8>> {
    ensure!(
        preset.slot < 4
            && preset.mode == 0
            && preset.direction == 0
            && preset.speed == 0
            && preset.step == 1,
        "仅支持同一步组合场景"
    );
    valid_indices(&preset.locals, 14, false)?;
    let mut data = vec![preset.slot, 0, preset.locals.len() as u8];
    data.extend(&preset.locals);
    data.extend([0, 0, 0, 1]);
    frame(0x53, true, &data)
}
pub fn order_frame(slot: u8, locals: &[u8]) -> Result<Vec<u8>> {
    ensure!(slot < 4, "高级槽位无效");
    valid_indices(locals, 14, false)?;
    let mut data = vec![slot, 0, locals.len() as u8];
    data.extend(locals);
    frame(0x54, true, &data)
}
pub fn preview(scene: &Scene, points: &[u8]) -> Result<Vec<u8>> {
    scene.validate()?;
    valid_indices(points, 23, false)?;
    if scene.scope == Scope::Whole {
        return whole_frame(0x43, 0, true, &scene.light, scene.direction, scene.speed);
    }
    let light = &scene.points[points[0] as usize];
    ensure!(
        points
            .iter()
            .all(|p| same_light(light, &scene.points[*p as usize])),
        "一次局部试灯只能使用一组颜色、亮度和灯效"
    );
    local_frame(
        0x33,
        &LocalPreset {
            slot: 0,
            points: points.to_vec(),
            color_type: 0,
            light: light.clone(),
        },
    )
}
pub fn same_light(a: &Light, b: &Light) -> bool {
    a.color.eq_ignore_ascii_case(&b.color) && a.brightness == b.brightness && a.effect == b.effect
}
fn valid_indices(items: &[u8], max: u8, allow_empty: bool) -> Result<()> {
    ensure!(
        (allow_empty || !items.is_empty())
            && items.len() <= max as usize
            && items.iter().all(|n| *n < max)
            && items.iter().copied().collect::<BTreeSet<_>>().len() == items.len(),
        "数量、索引或重复项无效"
    );
    Ok(())
}
pub fn payload(packet: &[u8], cmd: u8) -> Result<&[u8]> {
    ensure!(
        packet.len() >= 5
            && packet[0] == 0xcc
            && packet[1] == cmd
            && packet.len() == packet[3] as usize + 5
            && packet.last() == Some(&0x55),
        "响应帧不完整或命令不匹配"
    );
    Ok(&packet[4..packet.len() - 1])
}
pub fn parse_list(packet: &[u8], cmd: u8) -> Result<Vec<u8>> {
    ensure!(matches!(cmd, 0x30 | 0x40 | 0x50), "列表命令无效");
    let data = payload(packet, cmd)?;
    valid_indices(data, if cmd == 0x30 { 14 } else { 4 }, true)?;
    Ok(data.to_vec())
}
fn decoded_light(data: &[u8]) -> Light {
    Light {
        color: format!("#{:02x}{:02x}{:02x}", data[0], data[1], data[2]),
        brightness: data[3],
        effect: data[4],
    }
}
pub fn parse_whole(packet: &[u8]) -> Result<WholePreset> {
    let p = payload(packet, 0x41)?;
    ensure!(p.len() == 10 && p[0] < 4 && p[1] <= 1, "全身详情格式无效");
    Ok(WholePreset {
        slot: p[0],
        enabled: p[1] == 1,
        color_type: p[2],
        light: decoded_light(&p[3..8]),
        direction: p[8],
        speed: p[9],
    })
}
pub fn parse_local(packet: &[u8]) -> Result<LocalPreset> {
    let p = payload(packet, 0x31)?;
    ensure!(
        p.len() >= 8 && p[0] < 14 && p.len() == 8 + p[1] as usize,
        "局部详情格式无效"
    );
    let n = p[1] as usize;
    valid_indices(&p[2..2 + n], 40, false)?; // Legacy APK presets may contain indices 23–39; preserve them read-only.
    Ok(LocalPreset {
        slot: p[0],
        points: p[2..2 + n].to_vec(),
        color_type: p[2 + n],
        light: decoded_light(&p[3 + n..]),
    })
}
pub fn parse_advanced(packet: &[u8]) -> Result<AdvancedPreset> {
    let p = payload(packet, 0x51)?;
    ensure!(
        p.len() >= 7 && p[0] < 4 && p[1] <= 1 && p.len() == 7 + p[2] as usize,
        "高级详情格式无效"
    );
    let n = p[2] as usize;
    valid_indices(&p[3..3 + n], 14, true)?;
    Ok(AdvancedPreset {
        slot: p[0],
        enabled: p[1] == 1,
        locals: p[3..3 + n].to_vec(),
        mode: p[3 + n],
        direction: p[4 + n],
        speed: p[5 + n],
        step: p[6 + n],
        orders: vec![],
    })
}
pub fn parse_orders(packet: &[u8], slot: u8) -> Result<Vec<Order>> {
    let p = payload(packet, 0x52)?;
    ensure!(p.first() == Some(&slot), "顺序详情槽位不匹配");
    let mut at = 1;
    let mut out = vec![];
    let mut seen = BTreeSet::new();
    while at < p.len() {
        let head = p.get(at..at + 2).context("顺序记录不完整")?;
        let n = head[1] as usize;
        ensure!(head[0] < 14 && seen.insert(head[0]), "顺序编号无效或重复");
        let refs = p.get(at + 2..at + 2 + n).context("顺序引用不完整")?;
        valid_indices(refs, 14, true)?;
        out.push(Order {
            index: head[0],
            locals: refs.to_vec(),
        });
        at += 2 + n;
    }
    Ok(out)
}
pub fn matches_request(reply: &[u8], request: &[u8]) -> bool {
    if request.len() < 5 || payload(reply, request[1]).is_err() {
        return false;
    }
    if request[2] == 1 {
        return reply[1..] == request[1..];
    }
    request[3] == 0 || reply.get(4) == request.get(4)
}
#[derive(Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}
impl Decoder {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.buffer.extend(bytes);
        let mut out = vec![];
        loop {
            let Some(start) = self.buffer.iter().position(|b| *b == 0xcc) else {
                self.buffer.clear();
                break;
            };
            self.buffer.drain(..start);
            if self.buffer.len() < 4 {
                break;
            }
            let size = 5 + self.buffer[3] as usize;
            if self.buffer.len() < size {
                break;
            }
            if self.buffer[size - 1] != 0x55 {
                self.buffer.remove(0);
                continue;
            }
            out.push(self.buffer.drain(..size).collect());
        }
        out
    }
}
pub fn hex(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}
