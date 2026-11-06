import { describe, expect, it } from "vite-plus/test";
import {
  createShortcut,
  isEditableTarget,
  isImeEnter,
  recordShortcut,
  searchShortcut,
  undoShortcut,
} from "../keys";

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

describe("searchShortcut", () => {
  it("maps Ctrl+K and Super+K", () => {
    expect(searchShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(searchShortcut(key({ key: "K", metaKey: true }))).toBe(true);
  });

  it("ignores other modifiers, repeats, composition and other keys", () => {
    expect(searchShortcut(key({ key: "k" }))).toBe(false);
    expect(searchShortcut(key({ key: "k", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(searchShortcut(key({ key: "k", ctrlKey: true, altKey: true }))).toBe(false);
    expect(searchShortcut(key({ key: "k", ctrlKey: true, repeat: true }))).toBe(false);
    expect(searchShortcut(key({ key: "k", ctrlKey: true, isComposing: true }))).toBe(false);
    expect(searchShortcut(key({ key: "z", ctrlKey: true }))).toBe(false);
  });
});

describe("undoShortcut", () => {
  it("maps Ctrl+Z and Super+Z only", () => {
    expect(undoShortcut(key({ key: "z", ctrlKey: true }))).toBe(true);
    expect(undoShortcut(key({ key: "Z", metaKey: true }))).toBe(true);
  });

  it("ignores redo combos, repeated keys and composition", () => {
    expect(undoShortcut(key({ key: "z", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(undoShortcut(key({ key: "y", ctrlKey: true }))).toBe(false);
    expect(undoShortcut(key({ key: "z", ctrlKey: true, repeat: true }))).toBe(false);
    expect(undoShortcut(key({ key: "z", ctrlKey: true, isComposing: true }))).toBe(false);
    expect(undoShortcut(key({ key: "k", ctrlKey: true }))).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("guards text entry and leaves buttons alone", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(
      isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
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
