// Auto-Update: prüft beim Start (nur in der Desktop-App) auf eine neue Version.
// Inert, solange in tauri.conf keine Updater-Konfig (Endpoint + pubkey) steht –
// dann wirft check() und wir ignorieren es still.
const isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export async function checkForUpdate() {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body || "",
      install: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    return null; // kein Updater konfiguriert / offline / nicht in Tauri
  }
}
