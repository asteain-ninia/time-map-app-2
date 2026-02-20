import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setupAnchoredFactories.js"],
    include: ["tests/**/*.test.js"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["node_modules", "dist", "public", "assets"]
    }
  }
});
