import { describe, expect, it } from "vite-plus/test";
import { createShortcut, isImeEnter, recordShortcut } from "../keys";

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "A",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("isImeEnter", () => {
  it("ignores the Enter that commits an IME candidate", () => {
    expect(isImeEnter({ isComposing: true } as KeyboardEvent)).toBe(true);
    expect(isImeEnter({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
  });

  it("accepts a plain Enter", () => {
    expect(isImeEnter({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false);
  });
});

describe("createShortcut", () => {
  it("maps Ctrl+N and Ctrl+Shift+N to task and project", () => {
    expect(createShortcut(key({ key: "n", ctrlKey: true }))).toBe("task");
    expect(createShortcut(key({ key: "N", ctrlKey: true, shiftKey: true }))).toBe("project");
    expect(createShortcut(key({ key: "n", metaKey: true }))).toBe("task");
    expect(createShortcut(key({ key: "N", metaKey: true, shiftKey: true }))).toBe("project");
  });

  it("ignores keys without the command modifier or with Alt", () => {
    expect(createShortcut(key({ key: "n" }))).toBeNull();
    expect(createShortcut(key({ key: "n", shiftKey: true }))).toBeNull();
    expect(createShortcut(key({ key: "n", ctrlKey: true, altKey: true }))).toBeNull();
    expect(createShortcut(key({ key: "m", ctrlKey: true }))).toBeNull();
  });

  it("ignores repeats and IME composition", () => {
    expect(createShortcut(key({ key: "n", ctrlKey: true, repeat: true }))).toBeNull();
    expect(createShortcut(key({ key: "n", ctrlKey: true, isComposing: true }))).toBeNull();
  });
});

describe("recordShortcut", () => {
  it("keeps listening until a key is pressed with Ctrl or Super", () => {
    expect(recordShortcut(key({}))).toBeNull();
    expect(recordShortcut(key({ shiftKey: true }))).toBeNull();
    expect(recordShortcut(key({ altKey: true, key: "F4" }))).toBeNull();
    expect(recordShortcut(key({ key: "Control", ctrlKey: true }))).toBeNull();
  });

  it("records the modifier order and uppercases a letter", () => {
    expect(recordShortcut(key({ key: "p", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(recordShortcut(key({ key: "k", metaKey: true }))).toBe("Super+K");
    expect(recordShortcut(key({ key: "F4", ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+F4");
  });
});
