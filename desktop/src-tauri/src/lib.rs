mod ble;
use model_light_core::controller::Controller;
use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct RuntimeInfo {
    label: &'static str,
    device_mode: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        label: if cfg!(target_os = "macos") {
            "Mac 桌面"
        } else {
            "桌面开发预览"
        },
        device_mode: "ble",
    }
}

#[tauri::command]
async fn export_scenes(app: tauri::AppHandle, contents: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selection = app
            .dialog()
            .file()
            .add_filter("Scene library", &["json"])
            .set_file_name("unicorn-scenes.json")
            .blocking_save_file();
        let Some(file) = selection else {
            return Ok(false);
        };
        let path = file.as_path().ok_or("无法访问选中的文件路径。")?;
        std::fs::write(path, contents).map_err(|error| error.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let controller = Arc::new(Controller::new(app.path().app_log_dir()?)?);
            let mut events = controller.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            let _ = handle.emit("ble:event", event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            app.manage(controller);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            export_scenes,
            ble::ble_scan,
            ble::ble_connect,
            ble::ble_disconnect,
            ble::ble_status,
            ble::ble_refresh,
            ble::ble_preview,
            ble::ble_activate,
            ble::ble_stop
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Unicorn Light Studio");
}
