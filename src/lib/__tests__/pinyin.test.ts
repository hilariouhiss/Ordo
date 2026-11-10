import { describe, expect, it } from "vite-plus/test";
import { matchesName, nameInitials, pinyinInitial } from "../pinyin";

describe("pinyin initials", () => {
  it("reads the initial of a common character", () => {
    expect(pinyinInitial("刘")).toBe("l");
    expect(pinyinInitial("王")).toBe("w");
    expect(pinyinInitial("凯")).toBe("k");
  });

  it("keeps latin letters and drops punctuation", () => {
    expect(pinyinInitial("A")).toBe("a");
    expect(pinyinInitial("·")).toBe("");
  });

  it("spells a name as initials", () => {
    expect(nameInitials("刘雨洁")).toBe("lyj");
    expect(nameInitials("艾伦·王")).toBe("alw");
  });

  it("uses the surname reading of a polyphonic first character", () => {
    expect(nameInitials("曾雨洁")).toBe("zyj");
    expect(nameInitials("单雄")).toBe("sx");
    expect(nameInitials("解缙")).toBe("xj");
    expect(nameInitials("区伯")).toBe("ob");
  });

  it("keeps the everyday reading after the first character", () => {
    expect(nameInitials("雨曾")).toBe("yc");
  });
});

describe("matchesName", () => {
  it("matches the name as typed", () => {
    expect(matchesName("刘雨洁", "刘雨")).toBe(true);
    expect(matchesName("刘雨洁", "王")).toBe(false);
  });

  it("matches full or partial initials", () => {
    expect(matchesName("刘雨洁", "lyj")).toBe(true);
    expect(matchesName("刘雨洁", "yj")).toBe(true);
    expect(matchesName("刘雨洁", "lj")).toBe(false);
  });
});
