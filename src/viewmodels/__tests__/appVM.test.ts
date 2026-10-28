import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ bootstrap: vi.fn() }));

import { bootstrap } from "../../model/ipc";
import { createAppVM } from "../appVM";
import { defaultSettings } from "./fixtures";

describe("appVM", () => {
  it("loads people and categories into state", async () => {
    vi.mocked(bootstrap).mockResolvedValue({
      people: [{ id: "p1", name: "我", isMe: true }],
      categories: [{ id: "c1", name: "软件", sortOrder: 0 }],
      tags: [],
      settings: defaultSettings,
      projects: [],
    });
    const vm = createAppVM();
    await vm.load();
    expect(vm.state.ready).toBe(true);
    expect(vm.state.people[0].name).toBe("我");
    expect(vm.me.value?.isMe).toBe(true);
  });
});
