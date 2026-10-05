import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Capacitor 壳的前端构建（产物交给 cap sync 拷进 Android）。
export default defineConfig({
  // Electron 用 file:// 加载 dist，必须用相对路径引用资源
  base: "./",
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
