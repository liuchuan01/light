//! One serialized transaction. Subscription must be created before the first write.
use crate::protocol::matches_request;
use anyhow::{Context, Result};
use std::{future::Future, time::Duration};
use tokio::{
    sync::broadcast,
    time::{sleep, timeout},
};

pub(crate) async fn exchange<F, Fut>(
    packet: &[u8],
    mut replies: broadcast::Receiver<Vec<u8>>,
    mut send: F,
) -> Result<Vec<u8>>
where
    F: FnMut(Vec<u8>) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    // APK starts with 20-byte ATT payloads and spaces fragments by 20 ms.
    for (index, chunk) in packet.chunks(20).enumerate() {
        if index > 0 {
            sleep(Duration::from_millis(20)).await;
        }
        timeout(Duration::from_secs(10), send(chunk.to_vec()))
            .await
            .context("写入 API 超时，设备状态未知")??;
    }
    timeout(Duration::from_secs(4), async {
        loop {
            let received = replies.recv().await.context("通知丢失或接收已结束")?;
            if matches_request(&received, packet) {
                return Ok(received);
            }
        }
    })
    .await
    .context("等待设备响应超时；未自动重发，可能已部分写入")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::*;
    #[tokio::test(start_paused = true)]
    async fn captures_immediate_echo_and_ignores_unrelated_frames() {
        let (tx, rx) = broadcast::channel(10);
        let packet = switch(0x44, 0, true).unwrap();
        let result = exchange(&packet, rx, |mut chunk| {
            tx.send(vec![0xcc, 0x30, 0, 0, 0x55]).unwrap();
            chunk[0] = 0xcc;
            tx.send(chunk).unwrap();
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert_eq!(result[1..], packet[1..]);
    }
    #[tokio::test(start_paused = true)]
    async fn timeout_never_retransmits() {
        let (_tx, rx) = broadcast::channel(10);
        let mut calls = 0;
        let error = exchange(&switch(0x44, 0, true).unwrap(), rx, |_| {
            calls += 1;
            async { Ok(()) }
        })
        .await
        .unwrap_err();
        assert!(error.to_string().contains("超时"));
        assert_eq!(calls, 1);
    }
    #[tokio::test(start_paused = true)]
    async fn fragments_long_local_write_before_waiting_for_echo() {
        let (tx, rx) = broadcast::channel(10);
        let packet = local_frame(
            0x32,
            &LocalPreset {
                slot: 0,
                points: (0..23).collect(),
                color_type: 0,
                light: Light {
                    color: "#ff0000".into(),
                    brightness: 10,
                    effect: 0,
                },
            },
        )
        .unwrap();
        let mut sent = vec![];
        let mut lengths = vec![];
        exchange(&packet, rx, |chunk| {
            lengths.push(chunk.len());
            sent.extend(chunk);
            if sent.len() == packet.len() {
                let mut reply = sent.clone();
                reply[0] = 0xcc;
                tx.send(reply).unwrap();
            }
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert_eq!(lengths, vec![20, 16]);
        assert_eq!(sent, packet);
    }
    #[tokio::test(start_paused = true)]
    async fn write_error_does_not_continue_or_retry() {
        let (_tx, rx) = broadcast::channel(10);
        let mut calls = 0;
        assert!(exchange(&[0xbc; 45], rx, |_| {
            calls += 1;
            async { anyhow::bail!("link lost") }
        })
        .await
        .is_err());
        assert_eq!(calls, 1);
    }
}
