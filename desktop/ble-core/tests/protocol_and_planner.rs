use model_light_core::{planner, protocol::*};
fn bytes(s: &str) -> Vec<u8> {
    s.split_whitespace()
        .map(|b| u8::from_str_radix(b, 16).unwrap())
        .collect()
}
fn red() -> Light {
    Light {
        color: "#ff0000".into(),
        brightness: 10,
        effect: 0,
    }
}
fn scene() -> Scene {
    Scene {
        id: "scene-1".into(),
        name: "测试".into(),
        scope: Scope::Whole,
        light: red(),
        points: vec![red(); 23],
        direction: 0,
        speed: 0,
    }
}
fn advanced(slot: u8, locals: Vec<u8>) -> AdvancedPreset {
    AdvancedPreset {
        slot,
        enabled: false,
        locals,
        mode: 0,
        direction: 0,
        speed: 0,
        step: 1,
        orders: vec![],
    }
}
fn local(slot: u8, points: Vec<u8>) -> LocalPreset {
    LocalPreset {
        slot,
        points,
        color_type: 0,
        light: red(),
    }
}
#[test]
fn recorded_full_save_open_and_read() {
    assert_eq!(
        whole_frame(0x42, 0, false, &red(), 0, 0).unwrap(),
        bytes("BC 42 01 0A 00 00 00 FF 00 00 0A 00 00 00 55")
    );
    assert_eq!(
        switch(0x44, 0, true).unwrap(),
        bytes("BC 44 01 02 00 01 55")
    );
    let p = parse_whole(&bytes("CC 41 00 0A 00 01 00 FF 00 00 0A 00 00 00 55")).unwrap();
    assert!(p.enabled);
    assert_eq!(p.light, red());
}
#[test]
fn recorded_group_save_and_order_read() {
    let p = advanced(0, vec![0, 1]);
    assert_eq!(
        advanced_frame(&p).unwrap(),
        bytes("BC 53 01 09 00 00 02 00 01 00 00 00 01 55")
    );
    assert_eq!(
        parse_orders(&bytes("CC 52 00 05 00 00 02 00 01 55"), 0).unwrap(),
        vec![Order {
            index: 0,
            locals: vec![0, 1]
        }]
    );
    let p = parse_advanced(&bytes("CC 51 00 09 00 01 02 00 01 00 00 00 01 55")).unwrap();
    assert!(p.enabled);
    assert_eq!(p.locals, vec![0, 1]);
}
#[test]
fn local_roundtrip_and_unknown_values_are_preserved_read_only() {
    let mut wire = local_frame(0x32, &local(13, (0..23).collect())).unwrap();
    wire[0] = 0xcc;
    wire[1] = 0x31;
    wire[2] = 0;
    assert_eq!(parse_local(&wire).unwrap(), local(13, (0..23).collect()));
    let p = parse_local(&bytes("CC 31 00 09 00 01 27 02 FF 00 00 64 08 55")).unwrap();
    assert_eq!(p.points, vec![39]);
    assert_eq!(p.light.brightness, 100);
    assert!(local_frame(0x32, &p).is_err());
}
#[test]
fn list_rejects_bad_counts_duplicates_and_out_of_range() {
    assert_eq!(
        parse_list(&bytes("CC 30 00 02 00 01 55"), 0x30).unwrap(),
        vec![0, 1]
    );
    assert!(parse_list(&bytes("CC 40 00 00 55"), 0x40)
        .unwrap()
        .is_empty());
    for s in [
        "CC 40 00 02 00 55",
        "CC 40 00 02 00 00 55",
        "CC 40 00 01 04 55",
    ] {
        assert!(parse_list(&bytes(s), 0x40).is_err());
    }
}
#[test]
fn notifications_can_split_or_coalesce_and_payload_can_contain_markers() {
    let first = bytes("CC 41 00 0A 00 01 00 CC 55 00 0A 00 00 00 55");
    for split in 0..=first.len() {
        let mut decoder = Decoder::default();
        let mut frames = decoder.feed(&first[..split]);
        frames.extend(decoder.feed(&first[split..]));
        assert_eq!(frames, vec![first.clone()]);
    }
    let mut decoder = Decoder::default();
    let second = bytes("CC 30 00 00 55");
    let mut stream = vec![0xff, 0x00];
    stream.extend(&first);
    stream.extend(&second);
    assert_eq!(decoder.feed(&stream), vec![first, second]);
}
#[test]
fn only_matching_echo_or_requested_detail_completes_request() {
    let request = switch(0x44, 0, true).unwrap();
    let mut echo = request.clone();
    echo[0] = 0xcc;
    assert!(matches_request(&echo, &request));
    echo[5] = 0;
    assert!(!matches_request(&echo, &request));
    assert!(!matches_request(
        &bytes("CC 41 00 0A 01 01 00 FF 00 00 0A 00 00 00 55"),
        &query(0x41, Some(0)).unwrap()
    ));
}
#[test]
fn invalid_ui_inputs_and_mixed_previews_cannot_build_packets() {
    let mut s = scene();
    s.scope = Scope::Points;
    s.points[1].color = "#00ff00".into();
    assert!(preview(&s, &[0, 1]).is_err());
    for points in [vec![], vec![23], vec![0, 0]] {
        assert!(preview(&s, &points).is_err());
    }
    s.points[0].effect = 3;
    assert!(planner::compile(&s, &Inventory::default()).is_err());
    s = scene();
    s.light.color = "#é0000".into();
    assert!(s.validate().is_err());
}
#[test]
fn whole_plan_stops_old_modes_before_save_and_enable() {
    let mut inv = Inventory::default();
    let mut a = advanced(1, vec![2]);
    a.enabled = true;
    inv.advanced.push(a);
    let plan = planner::compile(&scene(), &inv).unwrap();
    assert_eq!(
        plan.steps.iter().map(|s| s.packet[1]).collect::<Vec<_>>(),
        vec![0x56, 0x42, 0x44]
    );
    assert_eq!(plan.steps[0].packet[5], 0);
    assert!(plan.steps[1].readback.is_some());
}
#[test]
fn protects_other_scenes_including_order_only_references() {
    let mut s = scene();
    s.scope = Scope::Points;
    let mut inv = Inventory::default();
    inv.local.push(local(0, vec![0]));
    inv.advanced.push(advanced(0, vec![0]));
    let mut other = advanced(1, vec![]);
    other.orders.push(Order {
        index: 0,
        locals: vec![0],
    });
    inv.advanced.push(other);
    let plan = planner::compile(&s, &inv).unwrap();
    let write = plan.steps.iter().find(|s| s.packet[1] == 0x32).unwrap();
    assert_eq!(write.packet[4], 1);
}
#[test]
fn reserves_exact_matches_before_recycling_target_slots() {
    let mut s = scene();
    s.scope = Scope::Points;
    s.points[0].color = "#00ff00".into();
    let inv = Inventory {
        local: vec![local(0, (1..23).collect()), local(1, vec![0])],
        advanced: vec![advanced(0, vec![0, 1])],
        ..Default::default()
    };
    let plan = planner::compile(&s, &inv).unwrap();
    let writes: Vec<_> = plan.steps.iter().filter(|s| s.packet[1] == 0x32).collect();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].packet[4], 1);
    assert_eq!(plan.steps.iter().filter(|s| s.packet[1] == 0x54).count(), 1);
}
#[test]
fn capacity_failure_produces_no_partial_plan() {
    let mut s = scene();
    s.scope = Scope::Points;
    let inv = Inventory {
        local: (0..14).map(|n| local(n, vec![0])).collect(),
        ..Default::default()
    };
    assert!(planner::compile(&s, &inv).is_err());
    for (i, p) in s.points.iter_mut().enumerate() {
        p.color = format!("#{i:06x}");
    }
    assert!(planner::compile(&s, &Inventory::default()).is_err());
}
