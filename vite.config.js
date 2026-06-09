import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-freundlich: relative Pfade, EIGENER fester Dev-Port (1420), damit Tauri
// immer das richtige iou.fm-Frontend lädt und nicht ein anderes Projekt auf 5173.
// strictPort: true -> ist der Port belegt, bricht Vite hörbar ab (statt still auszuweichen).
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", target: "es2020" },
});
