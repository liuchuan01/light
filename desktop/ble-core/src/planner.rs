use crate::protocol::*;
use anyhow::{ensure, Result};
use std::collections::BTreeSet;

#[derive(Clone, Debug)]
pub struct Step {
    pub packet: Vec<u8>,
    pub readback: Option<Vec<u8>>,
}
#[derive(Clone, Debug)]
pub struct Plan {
    pub steps: Vec<Step>,
    pub target_slot: u8,
    pub advanced: bool,
}
fn refs(preset: &AdvancedPreset) -> impl Iterator<Item = u8> + '_ {
    preset.locals.iter().copied().chain(
        preset
            .orders
            .iter()
            .flat_map(|step| step.locals.iter().copied()),
    )
}
fn local_equal(a: &LocalPreset, b: &LocalPreset) -> bool {
    let mut a_points = a.points.clone();
    let mut b_points = b.points.clone();
    a_points.sort();
    b_points.sort();
    a_points == b_points && a.color_type == b.color_type && same_light(&a.light, &b.light)
}
pub fn stop_steps(inventory: &Inventory) -> Result<Vec<Step>> {
    let mut steps = vec![];
    for preset in inventory.whole.iter().filter(|p| p.enabled) {
        steps.push(Step {
            packet: switch(0x44, preset.slot, false)?,
            readback: None,
        });
    }
    for preset in inventory.advanced.iter().filter(|p| p.enabled) {
        steps.push(Step {
            packet: switch(0x56, preset.slot, false)?,
            readback: None,
        });
    }
    Ok(steps)
}
/// Computes every slot before any device mutation. Other scenes' references are immutable.
pub fn compile(scene: &Scene, inventory: &Inventory) -> Result<Plan> {
    scene.validate()?;
    let slot = scene.slot()?;
    let mut steps = stop_steps(inventory)?;
    if scene.scope == Scope::Whole {
        steps.push(Step {
            packet: whole_frame(
                0x42,
                slot,
                false,
                &scene.light,
                scene.direction,
                scene.speed,
            )?,
            readback: Some(query(0x41, Some(slot))?),
        });
        steps.push(Step {
            packet: switch(0x44, slot, true)?,
            readback: None,
        });
        return Ok(Plan {
            steps,
            target_slot: slot,
            advanced: false,
        });
    }
    let mut groups: Vec<LocalPreset> = vec![];
    for (point, light) in scene.points.iter().enumerate() {
        if let Some(group) = groups.iter_mut().find(|g| same_light(&g.light, light)) {
            group.points.push(point as u8);
        } else {
            groups.push(LocalPreset {
                slot: 0,
                points: vec![point as u8],
                color_type: 0,
                light: light.clone(),
            });
        }
    }
    ensure!(
        groups.len() <= 14,
        "场景包含 {} 组独立设置，超过当前局部槽位上限 14；未写入设备",
        groups.len()
    );
    let protected: BTreeSet<u8> = inventory
        .advanced
        .iter()
        .filter(|p| p.slot != slot)
        .flat_map(refs)
        .collect();
    let all_refs: BTreeSet<u8> = inventory.advanced.iter().flat_map(refs).collect();
    let target_refs: BTreeSet<u8> = inventory
        .advanced
        .iter()
        .filter(|p| p.slot == slot)
        .flat_map(refs)
        .collect();
    // Reserve ALL exact matches before considering any slots for overwrite.
    let mut assigned: Vec<Option<u8>> = groups
        .iter()
        .map(|group| {
            inventory
                .local
                .iter()
                .find(|local| local_equal(group, local))
                .map(|p| p.slot)
        })
        .collect();
    let mut used: BTreeSet<u8> = assigned.iter().flatten().copied().collect();
    for assignment in &mut assigned {
        if assignment.is_some() {
            continue;
        }
        let reusable = target_refs
            .iter()
            .copied()
            .find(|n| !protected.contains(n) && !used.contains(n));
        let free = (0..14).find(|n| {
            !used.contains(n)
                && !all_refs.contains(n)
                && !inventory.local.iter().any(|p| p.slot == *n)
        });
        let chosen = reusable.or(free).ok_or_else(|| {
            anyhow::anyhow!("可用局部槽位不足；保留其他场景及现有预设，未写入设备")
        })?;
        used.insert(chosen);
        *assignment = Some(chosen);
    }
    for (group, assigned) in groups.iter_mut().zip(assigned) {
        group.slot = assigned.expect("every group assigned");
        if !inventory
            .local
            .iter()
            .any(|p| p.slot == group.slot && local_equal(p, group))
        {
            steps.push(Step {
                packet: local_frame(0x32, group)?,
                readback: Some(query(0x31, Some(group.slot))?),
            });
        }
    }
    let locals: Vec<u8> = groups.iter().map(|g| g.slot).collect();
    let preset = AdvancedPreset {
        slot,
        enabled: false,
        locals: locals.clone(),
        mode: 0,
        direction: 0,
        speed: 0,
        step: 1,
        orders: vec![],
    };
    steps.push(Step {
        packet: advanced_frame(&preset)?,
        readback: Some(query(0x51, Some(slot))?),
    });
    // Explicit one-step order prevents an old custom sequence from surviving a replacement.
    steps.push(Step {
        packet: order_frame(slot, &locals)?,
        readback: Some(query(0x52, Some(slot))?),
    });
    steps.push(Step {
        packet: switch(0x56, slot, true)?,
        readback: None,
    });
    Ok(Plan {
        steps,
        target_slot: slot,
        advanced: true,
    })
}
