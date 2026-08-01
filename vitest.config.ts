import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "worker/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
