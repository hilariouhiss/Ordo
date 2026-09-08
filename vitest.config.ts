import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  // `hot: false` keeps the Solid refresh runtime out of test-transformed
  // modules, which Node cannot resolve under Vitest.
  plugins: [solid({ hot: false })],
  test: {
    environment: "node",
  },
});
