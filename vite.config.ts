import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendProxy = {
  target: "http://localhost:4100",
  changeOrigin: false
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": backendProxy,
      "/iptv": backendProxy,
      "/stream": backendProxy,
      "/artwork": backendProxy,
      "/media": backendProxy,
      "/discover.json": backendProxy,
      "/lineup.json": backendProxy,
      "/lineup.xml": backendProxy,
      "/lineup_status.json": backendProxy,
      "/lineup.post": backendProxy,
      "/device.xml": backendProxy,
      "/hdhomerun": backendProxy,
      "/auto": backendProxy
    }
  },
  build: {
    outDir: "dist/client"
  }
});
