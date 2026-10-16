import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The Rust crypto module ships a .wasm file that must not be pre-bundled.
  optimizeDeps: { exclude: ["@matrix-org/matrix-sdk-crypto-wasm"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
