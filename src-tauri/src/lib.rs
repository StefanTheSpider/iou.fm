// iou.fm – Tauri-Einstieg. HTTP-Plugin (Shopify/EZB ohne CORS), Process- und
// Updater-Plugin (Auto-Update), sowie biometrisches Entsperren (Touch ID / Windows Hello).

// ===== Biometrisches Entsperren ============================================
// Nach dem ersten Passwort-Login wird ein Entsperr-Schlüssel im sicheren OS-Speicher
// abgelegt (Keychain / Credential Manager). Beim nächsten Start gibt ein Biometrie-
// Prompt (Touch ID / Windows Hello) den Schlüssel frei – kein Tippen nötig.
#[cfg(desktop)]
mod biometric {
    use keyring::Entry;
    const SERVICE: &str = "fm.iou.app.unlock";

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }

    pub fn available() -> bool { true }

    pub fn prompt(reason: &str) -> Result<(), String> {
        use robius_authentication::{AndroidText, BiometricStrength, Context, PolicyBuilder, Text, WindowsText};
        let policy = PolicyBuilder::new()
            .biometrics(Some(BiometricStrength::Strong))
            .password(true)
            .build()
            .ok_or_else(|| "policy_build_failed".to_string())?;
        let windows = WindowsText::new("iou.fm", reason).ok_or_else(|| "windows_text_failed".to_string())?;
        let text = Text {
            android: AndroidText { title: "iou.fm", subtitle: None, description: Some(reason) },
            apple: reason,
            windows,
        };
        Context::new(())
            .blocking_authenticate(text, &policy)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn store(account: &str, secret: &str) -> Result<(), String> {
        entry(account)?.set_password(secret).map_err(|e| e.to_string())
    }
    pub fn fetch(account: &str) -> Result<String, String> {
        entry(account)?.get_password().map_err(|e| e.to_string())
    }
    pub fn clear(account: &str) -> Result<(), String> {
        let _ = entry(account)?.delete_credential();
        Ok(())
    }
    pub fn has(account: &str) -> bool {
        entry(account).and_then(|e| e.get_password().map_err(|x| x.to_string())).is_ok()
    }
}

#[cfg(not(desktop))]
mod biometric {
    pub fn available() -> bool { false }
    pub fn prompt(_r: &str) -> Result<(), String> { Err("nicht verfügbar".into()) }
    pub fn store(_a: &str, _s: &str) -> Result<(), String> { Err("nicht verfügbar".into()) }
    pub fn fetch(_a: &str) -> Result<String, String> { Err("nicht verfügbar".into()) }
    pub fn clear(_a: &str) -> Result<(), String> { Ok(()) }
    pub fn has(_a: &str) -> bool { false }
}

#[tauri::command]
fn bio_available() -> bool { biometric::available() }
#[tauri::command]
fn bio_has(account: String) -> bool { biometric::has(&account) }
#[tauri::command]
fn bio_enable(account: String, secret: String) -> Result<(), String> { biometric::store(&account, &secret) }
#[tauri::command]
fn bio_unlock(account: String) -> Result<String, String> {
    biometric::prompt("iou.fm entsperren")?;
    biometric::fetch(&account)
}
#[tauri::command]
fn bio_disable(account: String) -> Result<(), String> { biometric::clear(&account) }

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
        .invoke_handler(tauri::generate_handler![bio_available, bio_has, bio_enable, bio_unlock, bio_disable])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von iou.fm");
}
