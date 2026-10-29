import { spawn } from "node:child_process";

const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

// Both only read src/ and write separate outputs, so run them together.
const [typecheck, build] = await Promise.all([run("vue-tsc", ["--noEmit"]), run("vp", ["build"])]);

process.exit(typecheck === 0 && build === 0 ? 0 : 1);
