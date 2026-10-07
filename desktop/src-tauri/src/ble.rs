use model_light_core::{
    controller::{Controller, DeviceInfo, Status},
    protocol::Scene,
};
use std::sync::Arc;
use tauri::State;
type Ble<'a> = State<'a, Arc<Controller>>;
fn error(e: anyhow::Error) -> String {
    format!("{e:#}")
}
#[tauri::command]
pub async fn ble_scan(ble: Ble<'_>) -> Result<Vec<DeviceInfo>, String> {
    ble.scan().await.map_err(error)
}
#[tauri::command]
pub async fn ble_connect(ble: Ble<'_>, id: String) -> Result<Status, String> {
    ble.connect(&id).await.map_err(error)
}
#[tauri::command]
pub async fn ble_disconnect(ble: Ble<'_>) -> Result<(), String> {
    ble.disconnect().await.map_err(error)
}
#[tauri::command]
pub async fn ble_status(ble: Ble<'_>) -> Result<Status, String> {
    Ok(ble.status().await)
}
#[tauri::command]
pub async fn ble_refresh(ble: Ble<'_>) -> Result<Status, String> {
    ble.refresh().await.map_err(error)
}
#[tauri::command]
pub async fn ble_preview(ble: Ble<'_>, scene: Scene, points: Vec<u8>) -> Result<(), String> {
    ble.preview(&scene, &points).await.map_err(error)
}
#[tauri::command]
pub async fn ble_activate(ble: Ble<'_>, scene: Scene) -> Result<Status, String> {
    ble.activate(&scene).await.map_err(error)
}
#[tauri::command]
pub async fn ble_stop(ble: Ble<'_>) -> Result<Status, String> {
    ble.stop().await.map_err(error)
}
