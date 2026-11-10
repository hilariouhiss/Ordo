import { describe, expect, it } from "vite-plus/test";
import { errorText } from "../i18n";

// The backend's short codes and the sentences here are two lists that must agree; this
// test reads the Rust sources so a new code cannot reach the user as raw snake_case.
const sources = import.meta.glob("../../../src-tauri/src/**/*.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Codes the backend raises where no toast can show them, so no sentence is needed. */
const SILENT = new Set([
  "invalid_local_time",
  "missing_db",
  "no_app_data_dir",
  "no_backup_to_restore",
  "restored_backup_empty",
  "restored_backup_too_new",
  "pre_migration_backup_failed",
  "ai_empty",
  "ai_empty_or_invalid",
]);

describe("backend error codes", () => {
  it("reads the backend sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
  });

  it("every code that can reach the user has a sentence", () => {
    const missing = new Set<string>();
    for (const text of Object.values(sources)) {
      const pattern =
        /(?:Err\(|ok_or\(|ok_or_else\(\|\||map_err\(\|_\)\s*)"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g;
      for (const match of text.matchAll(pattern)) {
        const code = match[1];
        if (SILENT.has(code)) continue;
        if (errorText(code) === code) missing.add(code);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
