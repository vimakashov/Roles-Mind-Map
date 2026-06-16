import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Roles Mind Map",
        short_name: "Roles",
        theme_color: "#dcb6b6",
        background_color: "#faf6f5",
        display: "standalone",
        icons: [],
      },
    }),
  ],
  server: { proxy: { "/api": "http://0.0.0.0:3000" } },
  build: { outDir: "dist" },
});
