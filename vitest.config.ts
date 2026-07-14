import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run in Node — all test targets are pure TS/crypto, no DOM needed.
    // Node 20 ships globalThis.crypto (Web Crypto API), TextEncoder, btoa/atob.
    environment: "node",

    // Include only .test.ts files (no .tsx — no React rendering in tests)
    include: ["src/**/*.test.ts"],

    // Argon2id with the OWASP-recommended params (19 MiB) takes ~1–2 s on
    // a modern machine; give individual tests extra headroom.
    testTimeout: 30_000,
  },
});
