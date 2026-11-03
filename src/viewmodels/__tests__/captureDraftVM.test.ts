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
    draft.setRaw("把方案发出去 #华东客户交付 @老李 !高 ~2天");

    expect(draft.title.value).toBe("把方案发出去");
    expect(draft.fields.value).toEqual({
      projectId: "p1",
      ownerId: "u1",
      priority: "high",
      effortMinutes: 960,
    });
    expect(draft.matched.value).toEqual(["projectId", "ownerId", "priority", "effortMinutes"]);
  });

  it("derives the finish from the estimate", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 ~1小时");
    expect(draft.finish.value).toBe("2026-10-21");

    draft.setRaw("写方案 ~2天");
    expect(draft.finish.value).toBe("2026-10-22");
  });

  it("moves the finish with an edited estimate", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 ~1小时");
    draft.edit({ effortMinutes: 1440 });

    expect(draft.fields.value.effortMinutes).toBe(1440);
    expect(draft.finish.value).toBe("2026-10-23");
  });

  it("never stores a finish, because it always follows the estimate", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("^周五 写方案");

    expect(draft.fields.value).toEqual(CAPTURE_DEFAULTS);
    expect(draft.title.value).toBe("^周五 写方案");
  });

  it("keeps a manual edit when more text is typed", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 #华东客户交付 @老李 !高");
    draft.edit({ ownerId: null });

    draft.setRaw("写方案 #华东客户交付 @老李 !高 ~3小时");

    expect(draft.fields.value.ownerId).toBeNull();
    expect(draft.fields.value.effortMinutes).toBe(180);
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

  it("exposes a pending project name and drops it on an explicit pick", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("写方案 #新项目");
    expect(draft.newProjectName.value).toBe("新项目");
    expect(draft.matched.value).toContain("newProject");

    draft.edit({ projectId: null });
    expect(draft.newProjectName.value).toBeNull();
    expect(draft.matched.value).not.toContain("newProject");
  });

  it("drops the base project when the line names a new one", () => {
    const draft = draftWithBase();
    draft.setRaw("写方案 #新项目");

    expect(draft.fields.value.projectId).toBeNull();
    expect(draft.newProjectName.value).toBe("新项目");
  });

  it("does not let a chip edit rewrite the cleaned title", () => {
    const draft = createCaptureDraftVM(() => ctx);
    draft.setRaw("发邮件 #华东客户交付");
    draft.edit({ effortMinutes: 120 });

    expect(draft.title.value).toBe("发邮件");
    expect(draft.fields.value.effortMinutes).toBe(120);
  });
});
