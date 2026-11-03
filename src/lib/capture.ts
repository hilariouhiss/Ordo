import type { CaptureFields, Priority } from "../model/types";
import { parseEffortText, validEffort } from "./effort";

export interface CaptureContext {
  today: string;
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
}

export type CaptureField = keyof CaptureFields | "newProject";

export interface CaptureParse {
  /** The sentence with recognized symbol tokens removed. */
  title: string;
  fields: CaptureFields;
  matched: CaptureField[];
  /**
   * A `#name` that matches no project yet. Saving creates that project and files the
   * task under it; anything after whitespace is not part of the name.
   */
  newProjectName: string | null;
}

export interface CaptureSubmission {
  raw: string;
  title: string;
  fields: CaptureFields;
  newProjectName: string | null;
}

export const CAPTURE_DEFAULTS: CaptureFields = {
  projectId: null,
  ownerId: null,
  priority: "normal",
  effortMinutes: 480,
};

const FIELD_ORDER: CaptureField[] = [
  "projectId",
  "ownerId",
  "priority",
  "effortMinutes",
  "newProject",
];

const SYMBOLS = new Set(["#", "@", "!", "~"]);
const ASCII_WORD = /[A-Za-z0-9_]/;

interface PrefixMatch<T> {
  value: T;
  length: number;
}

/**
 * Reads the explicit token syntax only: #project @owner !priority ~effort.
 * Bare names and dates are left as text, so a title can never be changed by
 * accident just because it contains a word that happens to be a project name.
 * The expected finish is not a token: it follows the estimate.
 */
export function parseCapture(
  raw: string,
  ctx: CaptureContext,
  base: Partial<CaptureFields> = {},
): CaptureParse {
  const fields: CaptureFields = { ...CAPTURE_DEFAULTS, ...base };
  const found: Partial<CaptureFields> = {};
  const matched = new Set<CaptureField>();
  const spans: { start: number; end: number }[] = [];
  let newProjectName: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const symbol = raw[i];
    if (!SYMBOLS.has(symbol)) continue;
    // "C#" and "foo@bar" are text, not tokens. A CJK character before the
    // symbol is fine, so "发给@老李" still works. A hash inside a URL is text too.
    if (i > 0 && (ASCII_WORD.test(raw[i - 1]) || "/.-:".includes(raw[i - 1]))) continue;
    if (spans.some((span) => i >= span.start && i < span.end)) continue;
    // "# name" with a space is a heading or plain text, never a token.
    if (i + 1 < raw.length && /\s/.test(raw[i + 1])) continue;

    let valueStart = i + 1;
    while (valueStart < raw.length && /\s/.test(raw[valueStart])) valueStart++;
    if (valueStart >= raw.length) continue;
    const text = raw.slice(valueStart);
    let end = -1;

    if (symbol === "#") {
      const match = matchName(text, ctx.projects);
      if (match) {
        found.projectId = match.item.id;
        matched.add("projectId");
        matched.delete("newProject");
        newProjectName = null;
        end = valueStart + match.length;
      } else {
        const name = matchNewProject(raw, valueStart);
        if (!name) continue;
        // The token cancels a base project: the sentence names one that is about to exist.
        found.projectId = null;
        newProjectName = name.text;
        matched.delete("projectId");
        matched.add("newProject");
        end = name.end;
      }
    } else if (symbol === "@") {
      const match = matchName(text, ctx.people);
      if (!match) continue;
      found.ownerId = match.item.id;
      matched.add("ownerId");
      end = valueStart + match.length;
    } else if (symbol === "!") {
      const match = matchPriority(text);
      if (!match) continue;
      found.priority = match.value;
      matched.add("priority");
      end = valueStart + match.length;
    } else {
      const match = matchEffort(text);
      if (!match) continue;
      found.effortMinutes = match.value;
      matched.add("effortMinutes");
      end = valueStart + match.length;
    }

    if (end <= valueStart) continue;
    spans.push({ start: i, end });
  }

  Object.assign(fields, found);
  const title = stripTokens(raw, spans);
  return {
    title,
    fields,
    matched: FIELD_ORDER.filter((field) => matched.has(field)),
    newProjectName,
  };
}

/**
 * The name of a project that does not exist yet. A bare `#` or a `#` followed by a
 * space is text, and the name stops at the next symbol, whitespace or punctuation,
 * so the rest of the sentence stays in the title.
 */
function matchNewProject(raw: string, valueStart: number): { text: string; end: number } | null {
  const stop = /[\s#@!~，,。.;；:：!！?？、]/u;
  let end = valueStart;
  while (end < raw.length && !stop.test(raw[end])) end++;
  const text = raw.slice(valueStart, end);
  if (!text) return null;
  return { text, end };
}

function stripTokens(raw: string, spans: { start: number; end: number }[]): string {
  const original = raw.trim();
  if (!spans.length) return original;
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const span of ordered) {
    if (span.start > cursor) out += raw.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  out += raw.slice(cursor);
  const cleaned = out.replace(/\s+/g, " ").trim();
  // A capture made only of tokens still needs a visible title.
  return cleaned || original;
}

function matchName<T extends { id: string; name: string }>(
  text: string,
  items: T[],
): { item: T; length: number } | null {
  let best: { item: T; length: number } | null = null;
  for (const item of items) {
    const name = item.name.trim();
    if (!name || name.length > text.length) continue;
    if (text.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    if (/[A-Za-z0-9]$/.test(name) && ASCII_WORD.test(text[name.length] ?? "")) continue;
    if (!best || name.length > best.length) best = { item, length: name.length };
  }
  return best;
}

const PRIORITY_WORDS: [string, Priority][] = [
  ["高优先级", "high"],
  ["优先级高", "high"],
  ["最高优先级", "high"],
  ["最高优先", "high"],
  ["高优", "high"],
  ["紧急", "high"],
  ["加急", "high"],
  ["特急", "high"],
  ["火急", "high"],
  ["尽快", "high"],
  ["马上", "high"],
  ["立刻", "high"],
  ["今天必须", "high"],
  ["high priority", "high"],
  ["urgent", "high"],
  ["asap", "high"],
  ["p0", "high"],
  ["p1", "high"],
  ["高", "high"],
  ["低优先级", "low"],
  ["优先级低", "low"],
  ["最低优先级", "low"],
  ["最低优先", "low"],
  ["低优", "low"],
  ["不急", "low"],
  ["不着急", "low"],
  ["有空再", "low"],
  ["慢慢来", "low"],
  ["low priority", "low"],
  ["p3", "low"],
  ["p4", "low"],
  ["低", "low"],
  ["中优先级", "normal"],
  ["优先级中", "normal"],
  ["中优", "normal"],
  ["普通优先", "normal"],
  ["正常优先", "normal"],
  ["normal priority", "normal"],
  ["medium priority", "normal"],
  ["p2", "normal"],
  ["中", "normal"],
  ["普通", "normal"],
];

const PRIORITY_BY_LENGTH = [...PRIORITY_WORDS].sort((a, b) => b[0].length - a[0].length);

function matchPriority(text: string): PrefixMatch<Priority> | null {
  const lower = text.toLowerCase();
  for (const [word, priority] of PRIORITY_BY_LENGTH) {
    if (!lower.startsWith(word)) continue;
    if (/[A-Za-z0-9]$/.test(word) && ASCII_WORD.test(text[word.length] ?? "")) continue;
    return { value: priority, length: word.length };
  }
  return null;
}

const EFFORT_TOKEN =
  /^(\d{1,3}:\d{1,2}|\d+\s*小时\s*\d+\s*分|\d+(?:\.\d+)?\s*(?:个工作日|人天|人日|工作日|天|日|days|day|d|个?小时|h|hr|hours|分钟|分|minutes|minute|mins|min|m))/i;

/** Minutes, with the old day tokens still mapped at eight hours a day. */
function matchEffort(text: string): PrefixMatch<number> | null {
  if (text.startsWith("半天")) return { value: 240, length: 2 };
  const match = EFFORT_TOKEN.exec(text);
  if (match) {
    const raw = match[1];
    const days = /(?:个工作日|人天|人日|工作日|天|日|days|day|d)$/i.test(raw.trim());
    const total = days ? Math.round(parseFloat(raw) * 480) : parseEffortText(raw);
    if (total === null || !validEffort(total)) return null;
    return { value: total, length: match[0].length };
  }
  const bare = /^(\d+)(?=\s|$|[#@!~])/.exec(text);
  if (!bare) return null;
  const total = Number(bare[1]);
  return validEffort(total) ? { value: total, length: bare[0].length } : null;
}
