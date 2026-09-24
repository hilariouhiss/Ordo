/**
 * A throwaway static file server for testing the update path locally.
 *
 * Point a build's `plugins.updater.endpoints` at
 * `http://localhost:<port>/latest.json` (plus
 * `dangerousInsecureTransportProtocol: true`, since TLS is enforced otherwise),
 * serve the directory holding the signed installer + `latest.json`, and watch
 * this log to see the app ask for the feed and then the payload.
 *
 * Usage:
 *   node scripts/update-test-server.mjs [--dir <dir>] [--port 8787]
 *
 * Not part of the app: TLS is enforced in production, so this only ever works
 * against a build made with the two overrides above.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at === -1 ? fallback : args[at + 1];
};

const root = value("--dir", "src-tauri/target/release/bundle/nsis");
const port = Number(value("--port", "8787"));

const TYPES = {
  ".json": "application/json",
  ".exe": "application/octet-stream",
  ".sig": "text/plain",
  ".zip": "application/octet-stream",
};

createServer(async (request, response) => {
  // The log is the point: a line here is proof the app reached out.
  const at = new Date().toISOString().slice(11, 19);
  const path = normalize(decodeURIComponent((request.url ?? "/").split("?")[0]));
  // `normalize` + the join below keep `..` inside the served directory.
  const file = join(root, path);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    console.log(`${at}  ${request.method} ${path}  200  ${body.length} bytes`);
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    response.end(body);
  } catch {
    console.log(`${at}  ${request.method} ${path}  404`);
    response.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://localhost:${port}/latest.json`);
});
