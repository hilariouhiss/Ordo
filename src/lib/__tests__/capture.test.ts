import { describe, expect, it } from "vite-plus/test";
import { CAPTURE_DEFAULTS, parseCapture, type CaptureContext } from "../capture";
import type { CaptureFields } from "../../model/types";

const ctx: CaptureContext = {
  today: "2026-10-21",
  projects: [
    { id: "p1", name: "华东客户交付" },
    { id: "p2", name: "华东" },
    { id: "p3", name: "Alpha" },
    { id: "p4", name: "华东 客户" },
  ],
  people: [
    { id: "u1", name: "老李" },
    { id: "u2", name: "王工" },
    { id: "me", name: "我" },
    { id: "u3", name: "bar" },
  ],
};

function parse(raw: string, base: Partial<CaptureFields> = {}) {
  return parseCapture(raw, ctx, base);
}

function fields(over: Partial<CaptureFields> = {}): CaptureFields {
  return { ...CAPTURE_DEFAULTS, ...over };
}

function effort(raw: string): number {
  return parse(raw).fields.effortMinutes;
}

function priority(raw: string): string {
  return parse(raw).fields.priority;
}

describe("parseCapture", () => {
  it("leaves bare text alone", () => {
    expect(parse("  华东客户交付 老李 周五 高优 2天  ")).toEqual({
      title: "华东客户交付 老李 周五 高优 2天",
      fields: fields(),
      matched: [],
      newProjectName: null,
    });
  });

  it("reads all four symbols", () => {
    expect(parse("#华东客户交付 @老李 !P1 ~1.5h 把方案发出去")).toEqual({
      title: "把方案发出去",
      fields: fields({
        projectId: "p1",
        ownerId: "u1",
        priority: "high",
        effortMinutes: 90,
      }),
      matched: ["projectId", "ownerId", "priority", "effortMinutes"],
      newProjectName: null,
    });
  });

  it("reads symbols at the end too", () => {
    const parsed = parse("把方案发出去 #华东客户交付 @老李 !高 ~2天");
    expect(parsed.title).toBe("把方案发出去");
    expect(parsed.fields.projectId).toBe("p1");
    expect(parsed.fields.ownerId).toBe("u1");
    expect(parsed.fields.priority).toBe("high");
    expect(parsed.fields.effortMinutes).toBe(960);
  });

  it("prefers the longest matching project or person", () => {
    expect(parse("#华东客户交付 做方案").fields.projectId).toBe("p1");
    expect(parse("#华东 做方案").fields.projectId).toBe("p2");
    expect(parse("#华东 客户 做方案").fields.projectId).toBe("p4");
    expect(parse("@王工 做方案").fields.ownerId).toBe("u2");
  });

  it("allows an explicit one-character person", () => {
    const parsed = parse("@我 写周报");
    expect(parsed.fields.ownerId).toBe("me");
    expect(parsed.title).toBe("写周报");
  });

  it("does not treat C# or email addresses as tokens", () => {
    expect(parse("C#华东 做方案").fields.projectId).toBeNull();
    expect(parse("C#华东 做方案").title).toBe("C#华东 做方案");
    expect(parse("mail foo@bar.com").fields.ownerId).toBeNull();
    expect(parse("mail foo@bar.com").title).toBe("mail foo@bar.com");
  });

  it("lets the last valid token win and strips every valid token", () => {
    const parsed = parse("#华东 #华东客户交付 !低 !高 ~1天 ~2天 发邮件");
    expect(parsed.title).toBe("发邮件");
    expect(parsed.fields.projectId).toBe("p1");
    expect(parsed.fields.priority).toBe("high");
    expect(parsed.fields.effortMinutes).toBe(960);
  });

  it("leaves unrecognized symbols in the title", () => {
    const raw = "!foo ~foo @不存在 发邮件";
    expect(parse(raw)).toEqual({
      title: raw,
      fields: fields(),
      matched: [],
      newProjectName: null,
    });
  });

  it("keeps a lone hash or a hash followed by a space as text", () => {
    expect(parse("C# 课程 发邮件").newProjectName).toBeNull();
    expect(parse("# 标题 发邮件").newProjectName).toBeNull();
    expect(parse("# 标题 发邮件").title).toBe("# 标题 发邮件");
  });

  it("collapses whitespace after removing tokens", () => {
    expect(parse("  发邮件   #华东客户交付   给老李  ").title).toBe("发邮件 给老李");
  });

  it("keeps the raw line when every token was removed", () => {
    expect(parse("@老李 !高").title).toBe("@老李 !高");
  });

  it("orders matched fields consistently", () => {
    const parsed = parse("~2天 @老李 #华东 !高 发邮件");
    expect(parsed.matched).toEqual(["projectId", "ownerId", "priority", "effortMinutes"]);
  });
});

describe("new project tokens", () => {
  it("names a project that does not exist yet", () => {
    const parsed = parse("写方案 #二期交付");

    expect(parsed.newProjectName).toBe("二期交付");
    expect(parsed.fields.projectId).toBeNull();
    expect(parsed.title).toBe("写方案");
    expect(parsed.matched).toEqual(["newProject"]);
  });

  it("takes only the word right after the hash", () => {
    expect(parse("写方案 #新项目 明天发").newProjectName).toBe("新项目");
    expect(parse("写方案 #新项目, 明天发").newProjectName).toBe("新项目");
    expect(parse("写方案 #新项目，明天发").newProjectName).toBe("新项目");
    // A known name that prefixes the token wins, the same as every other token.
    expect(parse("写方案 #华东客户").newProjectName).toBeNull();
    expect(parse("写方案 #华东客户").fields.projectId).toBe("p2");
  });

  it("lets a known project replace the pending one and the other way round", () => {
    expect(parse("#新项目 #华东 写方案").newProjectName).toBeNull();
    expect(parse("#新项目 #华东 写方案").fields.projectId).toBe("p2");
    expect(parse("#华东 #新项目 写方案").newProjectName).toBe("新项目");
    expect(parse("#华东 #新项目 写方案").fields.projectId).toBeNull();
  });

  it("drops the base project of a project page when the line names a new one", () => {
    const parsed = parse("写方案 #新的", { projectId: "p2" });
    expect(parsed.fields.projectId).toBeNull();
    expect(parsed.newProjectName).toBe("新的");
  });

  it("ignores URL fragments", () => {
    const parsed = parse("看 https://example.com/a#section 写方案");
    expect(parsed.newProjectName).toBeNull();
    expect(parsed.title).toBe("看 https://example.com/a#section 写方案");
  });
});

describe("effort tokens", () => {
  it("reads hours, minutes and clock shapes", () => {
    expect(effort("~2小时")).toBe(120);
    expect(effort("~1.5h")).toBe(90);
    expect(effort("~30分钟")).toBe(30);
    expect(effort("~30m")).toBe(30);
    expect(effort("~2:30")).toBe(150);
  });

  it("still reads the old day shapes at eight hours a day", () => {
    expect(effort("~2天")).toBe(960);
    expect(effort("~1.5天")).toBe(720);
    expect(effort("~半天")).toBe(240);
    expect(effort("~2人天")).toBe(960);
    expect(effort("~2d")).toBe(960);
  });

  it("treats a bare number as minutes", () => {
    expect(effort("~90")).toBe(90);
  });

  it("falls back to the default outside the range", () => {
    expect(effort("~0")).toBe(480);
    expect(effort("~481h")).toBe(480);
  });
});

describe("priority tokens", () => {
  it("reads P levels", () => {
    expect(priority("!P0")).toBe("high");
    expect(priority("!p1")).toBe("high");
    expect(priority("!P2")).toBe("normal");
    expect(priority("!p3")).toBe("low");
    expect(priority("!p4")).toBe("low");
    expect(priority("!p10")).toBe("normal");
  });

  it("reads words in both languages", () => {
    expect(priority("!高")).toBe("high");
    expect(priority("!中")).toBe("normal");
    expect(priority("!低")).toBe("low");
    expect(priority("!高优先级")).toBe("high");
    expect(priority("!不急")).toBe("low");
    expect(priority("!urgent")).toBe("high");
    expect(priority("!low priority")).toBe("low");
    expect(priority("!normal priority")).toBe("normal");
  });
});
