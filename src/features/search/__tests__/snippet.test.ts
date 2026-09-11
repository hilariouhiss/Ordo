import { describe, expect, it } from "vitest";
import { parseSnippet } from "../snippet";

describe("parseSnippet", () => {
  it("returns a single plain segment when no markers exist", () => {
    expect(parseSnippet("无高亮片段")).toEqual([{ text: "无高亮片段", marked: false }]);
  });

  it("splits a marked highlight into surrounding segments", () => {
    expect(parseSnippet("前缀<mark>命中</mark>后缀")).toEqual([
      { text: "前缀", marked: false },
      { text: "命中", marked: true },
      { text: "后缀", marked: false },
    ]);
  });

  it("handles adjacent and multiple highlights", () => {
    expect(parseSnippet("<mark>a</mark>中间<mark>b</mark>")).toEqual([
      { text: "a", marked: true },
      { text: "中间", marked: false },
      { text: "b", marked: true },
    ]);
    expect(parseSnippet("<mark>a</mark><mark>b</mark>")).toEqual([
      { text: "a", marked: true },
      { text: "b", marked: true },
    ]);
  });

  it("renders an unterminated marker as plain text", () => {
    expect(parseSnippet("开头<mark>未闭合")).toEqual([
      { text: "开头<mark>未闭合", marked: false },
    ]);
    expect(parseSnippet("<mark></mark>")).toEqual([]);
  });

  it("returns no segments for an empty snippet", () => {
    expect(parseSnippet("")).toEqual([]);
  });
});
