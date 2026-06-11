// iou.fm – Tauri-Einstieg. HTTP-Plugin (Shopify/EZB ohne CORS), Process- und
// Updater-Plugin (Auto-Update), sowie biometrisches Entsperren (Touch ID / Windows Hello).

// ===== Biometrisches Entsperren ============================================
// Nach dem ersten Passwort-Login wird ein Entsperr-Schlüssel lokal abgelegt
// (geschützte Datei im App-Datenordner, nur fürs eigene Benutzerkonto lesbar).
// Beim nächsten Start gibt ein nativer Biometrie-Prompt (Touch ID / Windows Hello)
// den Schlüssel frei – kein Tippen, KEIN Schlüsselbund-Passwort nötig.
//
// Bewusste Entscheidung: NICHT den macOS-Schlüsselbund (keyring) nutzen. Dieser
// fragt bei jeder neuen (Dev-)Signatur erneut das Schlüsselbund-Passwort ab. Der
// Schutz besteht hier aus (a) dem Betriebssystem-Benutzerkonto + Dateirechten 0600
// und (b) dem Touch-ID/Windows-Hello-Prompt vor dem Lesen. Das Master-Passwort
// bleibt der eigentliche Schlüssel (E2E unverändert); Biometrie ist reine
// Geräte-lokale Bequemlichkeit.
#[cfg(desktop)]
mod biometric {
    use std::fs;
    use std::path::PathBuf;

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

    fn sanitize(account: &str) -> String {
        account.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect()
    }

    fn key_path(base: PathBuf, account: &str) -> PathBuf {
        base.join("bio").join(format!("{}.key", sanitize(account)))
    }

    pub fn store(base: PathBuf, account: &str, secret: &str) -> Result<(), String> {
        let p = key_path(base, account);
        if let Some(dir) = p.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
        fs::write(&p, secret.as_bytes()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }
    pub fn fetch(base: PathBuf, account: &str) -> Result<String, String> {
        let bytes = fs::read(key_path(base, account)).map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }
    pub fn clear(base: PathBuf, account: &str) -> Result<(), String> {
        let _ = fs::remove_file(key_path(base, account));
        Ok(())
    }
    pub fn has(base: PathBuf, account: &str) -> bool {
        key_path(base, account).exists()
    }
}

#[cfg(not(desktop))]
mod biometric {
    use std::path::PathBuf;
    pub fn available() -> bool { false }
    pub fn prompt(_r: &str) -> Result<(), String> { Err("nicht verfügbar".into()) }
    pub fn store(_b: PathBuf, _a: &str, _s: &str) -> Result<(), String> { Err("nicht verfügbar".into()) }
    pub fn fetch(_b: PathBuf, _a: &str) -> Result<String, String> { Err("nicht verfügbar".into()) }
    pub fn clear(_b: PathBuf, _a: &str) -> Result<(), String> { Ok(()) }
    pub fn has(_b: PathBuf, _a: &str) -> bool { false }
}

fn bio_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn bio_available() -> bool { biometric::available() }
#[tauri::command]
fn bio_has(app: tauri::AppHandle, account: String) -> bool {
    bio_base(&app).map(|b| biometric::has(b, &account)).unwrap_or(false)
}
#[tauri::command]
fn bio_enable(app: tauri::AppHandle, account: String, secret: String) -> Result<(), String> {
    biometric::store(bio_base(&app)?, &account, &secret)
}
#[tauri::command]
fn bio_unlock(app: tauri::AppHandle, account: String) -> Result<String, String> {
    biometric::prompt("iou.fm entsperren")?;
    biometric::fetch(bio_base(&app)?, &account)
}
#[tauri::command]
fn bio_disable(app: tauri::AppHandle, account: String) -> Result<(), String> {
    biometric::clear(bio_base(&app)?, &account)
}

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
