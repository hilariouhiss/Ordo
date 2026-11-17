import { describe, expect, it } from "vite-plus/test";
import type { Person } from "../../model/types";
import { task } from "../../viewmodels/__tests__/fixtures";
import { defaultReviewDay, parkedOnName, parkDefaults } from "../park";

const me: Person = { id: "u1", name: "我", isMe: true, categoryIds: [] };
const li: Person = { id: "u2", name: "老李", isMe: false, categoryIds: [] };
const people = [me, li];

describe("park defaults", () => {
  it("puts the review three days out", () => {
    expect(defaultReviewDay("2026-11-12")).toBe("2026-11-15");
    expect(defaultReviewDay("2026-11-29")).toBe("2026-12-02");
  });

  it("preselects an owner who is someone else", () => {
    expect(parkDefaults(task({ ownerId: "u2" }), people, "2026-11-12")).toEqual({
      personId: "u2",
      until: "2026-11-15",
    });
  });

  it("leaves the person empty when the owner is me or nobody", () => {
    expect(parkDefaults(task({ ownerId: "u1" }), people, "2026-11-12")).toEqual({
      personId: null,
      until: "2026-11-15",
    });
    expect(parkDefaults(task(), people, "2026-11-12")).toEqual({
      personId: null,
      until: "2026-11-15",
    });
  });

  it("keeps the current park while its day is still ahead", () => {
    const parked = task({ parked: true, parkedOnId: "u2", parkUntil: "2026-11-20" });
    expect(parkDefaults(parked, people, "2026-11-12")).toEqual({
      personId: "u2",
      until: "2026-11-20",
    });
  });

  it("falls back to the default day once the stored one has passed", () => {
    const parked = task({ parked: true, parkedOnId: "u2", parkUntil: "2026-11-01" });
    expect(parkDefaults(parked, people, "2026-11-12")).toEqual({
      personId: "u2",
      until: "2026-11-15",
    });
  });
});

describe("parkedOnName", () => {
  it("names the person a task waits on", () => {
    expect(parkedOnName(task({ parkedOnId: "u2" }), people)).toBe("老李");
  });

  it("stays empty for no person or a person gone from the list", () => {
    expect(parkedOnName(task({ parkedOnId: null }), people)).toBeNull();
    expect(parkedOnName(task({ parkedOnId: "gone" }), people)).toBeNull();
  });
});
