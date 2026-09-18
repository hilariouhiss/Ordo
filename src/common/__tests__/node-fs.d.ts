/*
 * `readFileSync` from Node's `fs`, for the one test that has to read a file off
 * disk (`design-constraints.test.ts` reads `src/index.css`).
 *
 * It cannot import the stylesheet instead: the CSS pipeline empties every style
 * import in the test environment, `?raw` and `?inline` both handing back "".
 * Declared here rather than by installing the Node type package, which nothing
 * else in `src/` needs — the app itself never touches the filesystem.
 *
 * Delete this file the day `@types/node` is added: the declarations below would
 * then collide with the real ones.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare const process: { cwd(): string };
