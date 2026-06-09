// iou.fm – Tauri-Einstieg. HTTP-Plugin (Shopify/EZB ohne CORS), Process- und
// Updater-Plugin (Auto-Update; aktiv, sobald in tauri.conf eine Updater-Konfig
// mit Endpoint + pubkey hinterlegt ist – siehe DISTRIBUTION.md).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init());

    // AUTO-UPDATE (Desktop): aktiv, da in tauri.conf "plugins.updater" konfiguriert ist.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von iou.fm");
}
