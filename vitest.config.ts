import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "bun:sqlite": resolve(__dirname, "src/test-helpers/bun-sqlite-shim.ts"),
    },
  },
  test: {
    globals: true,
    testTimeout: 10000,
  },
});
