import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Carry",
        short_name: "Carry",
        display: "standalone",
        theme_color: "#16182B",
        background_color: "#ffffff",
        start_url: "/",
      },
      workbox: {
        // Precache the app shell only (built static assets). No runtimeCaching
        // is defined, so Supabase Realtime/REST/auth calls are never cached.
        globPatterns: ["**/*.{js,css,html,svg,ico,png,woff2}"],
      },
    }),
  ],
});
