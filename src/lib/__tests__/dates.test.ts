import { describe, expect, it } from "vite-plus/test";
import { addDays } from "../dates";

describe("addDays", () => {
  it("stays on the same local date for offset 0", () => {
    expect(addDays("2026-10-20", 0)).toBe("2026-10-20");
    expect(addDays("2026-10-20", 1)).toBe("2026-10-21");
    expect(addDays("2026-10-20", -21)).toBe("2026-09-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
