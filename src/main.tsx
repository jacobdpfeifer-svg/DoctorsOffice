import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// Self-hosted fonts — eliminates the Google Fonts @import that was previously
// in styles.ts.  Vite processes these CSS files, content-hashes and copies the
// woff2 assets into dist/assets/, and the service worker's globPatterns
// ["**/*.woff2"] precaches them automatically — no vite.config.ts change needed.
//
// Only the latin subset is imported (matches the original Google Fonts request).
// Inter and IBM Plex Mono include unicode-range hints so the browser downloads
// a given file only if the page actually uses characters in that range.
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
