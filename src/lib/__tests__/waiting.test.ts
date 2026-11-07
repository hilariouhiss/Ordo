import { describe, expect, it } from "vite-plus/test";
import type { Person } from "../../model/types";
import { task } from "../../viewmodels/__tests__/fixtures";
import { defaultFollowUp, waitDefaults, waitingOnName } from "../waiting";

const me: Person = { id: "u1", name: "我", isMe: true };
const li: Person = { id: "u2", name: "老李", isMe: false };
const people = [me, li];

describe("waiting defaults", () => {
  it("puts the follow-up three days out", () => {
    expect(defaultFollowUp("2026-11-12")).toBe("2026-11-15");
    expect(defaultFollowUp("2026-11-29")).toBe("2026-12-02");
  });

  it("preselects an owner who is someone else", () => {
    expect(waitDefaults(task({ ownerId: "u2" }), people, "2026-11-12")).toEqual({
      personId: "u2",
      followUpDate: "2026-11-15",
    });
  });

  it("leaves the person empty when the owner is me or nobody", () => {
    expect(waitDefaults(task({ ownerId: "u1" }), people, "2026-11-12")).toEqual({
      personId: null,
      followUpDate: "2026-11-15",
    });
    expect(waitDefaults(task(), people, "2026-11-12")).toEqual({
      personId: null,
      followUpDate: "2026-11-15",
    });
  });

  it("keeps the current wait while its day is still ahead", () => {
    const waiting = task({ waiting: true, waitingOnId: "u2", followUpDate: "2026-11-20" });
    expect(waitDefaults(waiting, people, "2026-11-12")).toEqual({
      personId: "u2",
      followUpDate: "2026-11-20",
    });
  });

  it("falls back to the default day once the stored one has passed", () => {
    const waiting = task({ waiting: true, waitingOnId: "u2", followUpDate: "2026-11-01" });
    expect(waitDefaults(waiting, people, "2026-11-12")).toEqual({
      personId: "u2",
      followUpDate: "2026-11-15",
    });
  });
});

describe("waitingOnName", () => {
  it("names the person a task waits on", () => {
    expect(waitingOnName(task({ waitingOnId: "u2" }), people)).toBe("老李");
  });

  it("stays empty for no person or a person gone from the list", () => {
    expect(waitingOnName(task({ waitingOnId: null }), people)).toBeNull();
    expect(waitingOnName(task({ waitingOnId: "gone" }), people)).toBeNull();
  });
});
