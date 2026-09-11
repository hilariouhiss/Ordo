import { describe, expect, it } from "vitest";
import { isAppError, normalizeError } from "../errors";

const FALLBACK = "发生未知错误，请重试。";

describe("normalizeError", () => {
  it("passes through a valid payload", () => {
    expect(normalizeError({ code: "database", message: "boom" })).toEqual({
      code: "database",
      message: "boom",
    });
  });

  it("falls back to unknown for invalid codes", () => {
    expect(normalizeError({ code: "nope", message: "x" })).toEqual({
      code: "unknown",
      message: "x",
    });
  });

  it("recognises the io code the backup commands return", () => {
    expect(normalizeError({ code: "io", message: "拒绝访问" })).toEqual({
      code: "io",
      message: "拒绝访问",
    });
  });

  it("falls back to the generic message when the payload message is unusable", () => {
    expect(normalizeError({ code: "db", message: 42 })).toEqual({
      code: "db",
      message: FALLBACK,
    });
    expect(normalizeError({ code: "db", message: "  " })).toEqual({
      code: "db",
      message: FALLBACK,
    });
  });

  it("normalizes Error instances, strings and unknown values", () => {
    expect(normalizeError(new Error("network down"))).toEqual({
      code: "unknown",
      message: "network down",
    });
    expect(normalizeError("权限不足")).toEqual({ code: "unknown", message: "权限不足" });
    expect(normalizeError(undefined)).toEqual({ code: "unknown", message: FALLBACK });
    expect(normalizeError({ anything: true })).toEqual({ code: "unknown", message: FALLBACK });
  });
});

describe("isAppError", () => {
  it("guards normalized errors", () => {
    expect(isAppError({ code: "validation", message: "标题必填" })).toBe(true);
    expect(isAppError({ code: "validation" })).toBe(false);
    expect(isAppError({ code: "bogus", message: "x" })).toBe(false);
    expect(isAppError("x")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
