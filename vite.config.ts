import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const appVersion = process.env.npm_package_version ?? "unknown";
const BUILD_ID_PATTERN = /^build-\d{8}-\d{6}-jst$/;

function createJstBuildId(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});

  return `build-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}-jst`;
}

const requestedBuildId = process.env.NEBIKI_BUILD_ID?.trim();
const buildId =
  requestedBuildId && BUILD_ID_PATTERN.test(requestedBuildId)
    ? requestedBuildId
    : createJstBuildId(new Date());

export default defineConfig({
  define: {
    __NEBIKI_APP_VERSION__: JSON.stringify(appVersion),
    __NEBIKI_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-maskable-512x512.png",
      ],
      manifest: {
        name: "値引ヘルパー",
        short_name: "値引ヘルパー",
        description: "値引判断と残数記録を支援する業務用アプリ",
        lang: "ja",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f5f6f8",
        theme_color: "#b42318",
        categories: ["business", "productivity"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "index.html",
      },
    }),
  ],
});
