import { describe, expect, it } from "vite-plus/test";
import { CAPTURE_DEFAULTS } from "../../lib/capture";
import { createCaptureDraftVM } from "../captureDraftVM";

const ctx = {
  today: "2026-10-21",
  projects: [{ id: "p1", name: "华东客户交付" }],
  people: [{ id: "u1", name: "老李" }],
};

function draftWithBase() {
  return createCaptureDraftVM(
    () => ctx,
    () => ({ projectId: "p1" }),
  );
}

describe("captureDraftVM", () => {
  it("parses symbols and exposes a cleaned title", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("^周五前 把方案发出去 #华东客户交付 @老李 !高 ~2天");

    expect(draft.title.value).toBe("把方案发出去");
    expect(draft.fields.value).toEqual({
      projectId: "p1",
      ownerId: "u1",
      priority: "high",
      dueDate: "2026-10-23",
      effortMinutes: 960,
    });
    expect(draft.matched.value).toEqual([
      "projectId",
      "ownerId",
      "priority",
      "dueDate",
      "effortMinutes",
    ]);
  });

  it("keeps a manual edit when more text is typed", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 #华东客户交付 @老李 !高");
    draft.edit({ ownerId: null });

    draft.setRaw("写方案 #华东客户交付 @老李 !高 ^明天");

    expect(draft.fields.value.ownerId).toBeNull();
    expect(draft.fields.value.dueDate).toBe("2026-10-22");
    expect(draft.matched.value).not.toContain("ownerId");
  });

  it("clears manual edits when the line is cleared", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 #华东客户交付 @老李");
    draft.edit({ ownerId: null });
    expect(draft.fields.value.ownerId).toBeNull();

    draft.setRaw("   ");

    expect(draft.fields.value).toEqual(CAPTURE_DEFAULTS);
    expect(draft.state.manual).toEqual({});
  });

  it("resets raw and overrides together", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 @老李");
    draft.edit({ ownerId: null });

    draft.reset();

    expect(draft.state.raw).toBe("");
    expect(draft.fields.value).toEqual(CAPTURE_DEFAULTS);
  });

  it("uses the base project until a token overrides it", () => {
    const draft = draftWithBase();
    draft.setRaw("写方案");
    expect(draft.fields.value.projectId).toBe("p1");
    expect(draft.matched.value).toEqual([]);

    draft.setRaw("写方案 #华东客户交付");
    expect(draft.fields.value.projectId).toBe("p1");
    expect(draft.matched.value).toContain("projectId");
  });

  it("does not let a chip edit rewrite the cleaned title", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("^周五前 发邮件");
    draft.edit({ dueDate: "2026-12-31" });

    expect(draft.title.value).toBe("发邮件");
    expect(draft.fields.value.dueDate).toBe("2026-12-31");
  });
});
