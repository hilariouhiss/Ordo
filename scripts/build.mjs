import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const resolve = createRequire(import.meta.url);

// Spawning a CLI's own entry through `node` avoids `shell: true`, which Node
// deprecates for concatenating args unescaped, and behaves the same everywhere.
function cliBin(pkg, file) {
  const path = join(dirname(resolve.resolve(`${pkg}/package.json`)), "bin", file);
  if (!existsSync(path)) throw new Error(`Missing CLI entry: ${path}`);
  return path;
}

const run = (bin, args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: "inherit" });
    child.on("error", (error) => {
      console.error(error);
      done(1);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });

const tsc = cliBin("vue-tsc", "vue-tsc.js");
const vp = cliBin("vite-plus", "vp");

// Both only read src/ and write separate outputs, so run them together.
const [typecheck, build] = await Promise.all([run(tsc, ["--noEmit"]), run(vp, ["build"])]);

process.exit(typecheck === 0 && build === 0 ? 0 : 1);
