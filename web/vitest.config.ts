import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest wiring. Uses the same `@/*` alias as vite.config.ts so test imports
// match production imports.
//
// Step 12: flipped the default environment to `jsdom` so component tests can
// mount React trees without per-file `// @vitest-environment` headers. API
// tests (`api/__tests__/*.test.ts`) don't need the DOM but tolerate it —
// jsdom boot adds ~10ms per file, worth the uniformity.
//
// `setupFiles` loads jest-dom matchers (`toBeInTheDocument`, etc.) for every
// test file.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
