import { afterEach, describe, expect, it } from "vite-plus/test";
import { errorText, messages, setLanguage, t } from "../i18n";

afterEach(() => setLanguage("zh"));

describe("t", () => {
  it("defaults to Chinese", () => {
    expect(t("common.cancel")).toBe("取消");
  });

  it("switches to English", () => {
    setLanguage("en");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("interpolates variables", () => {
    expect(t("week.pending", { count: 3 })).toBe("3 件待定");
  });

  it("has the same keys and variables in both languages", () => {
    const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(messages.zh) as (keyof typeof messages.zh)[]) {
      expect(messages.en[key], `missing en ${key}`).toBeTruthy();
      expect(vars(messages.en[key]), `vars ${key}`).toEqual(vars(messages.zh[key]));
    }
  });
});

describe("errorText", () => {
  it("maps a known code", () => {
    expect(errorText("empty_title")).toBe("标题不能为空。");
    setLanguage("en");
    expect(errorText("empty_title")).toBe("Title can't be empty.");
  });

  it("passes unknown errors through", () => {
    expect(errorText("disk is full")).toBe("disk is full");
  });
});
