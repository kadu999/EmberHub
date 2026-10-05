import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Capacitor 壳的前端构建（产物交给 cap sync 拷进 Android）。
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5280,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
