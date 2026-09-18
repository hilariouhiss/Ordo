import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  // `hot: false` keeps the Solid refresh runtime out of test-transformed
  // modules, which Node cannot resolve under Vitest.
  plugins: [solid({ hot: false })],
  test: {
    // jsdom by default: almost every test reaches a component or a store that
    // reads `window`, and the pure-logic files are indifferent to it. The
    // browser APIs jsdom does not ship are installed once, by `setup.ts`.
    environment: "jsdom",
    setupFiles: ["src/common/components/__tests__/setup.ts"],
    // Without this Vitest re-transforms every module on every run, which was
    // over half of the suite's tracked time.
    fsModuleCache: true,
  },
});
