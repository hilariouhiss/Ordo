import type { CaptureFields, Priority } from "../model/types";
import { addDays, weekdayOf } from "./dates";

export interface CaptureContext {
  today: string;
  projects: { id: string; name: string }[];
  people: { id: string; name: string }[];
}

export type CaptureField = keyof CaptureFields;

export interface CaptureParse {
  /** The sentence with recognized symbol tokens removed. */
  title: string;
  fields: CaptureFields;
  matched: CaptureField[];
}

export interface CaptureSubmission {
  raw: string;
  title: string;
  fields: CaptureFields;
}

export const CAPTURE_DEFAULTS: CaptureFields = {
  projectId: null,
  ownerId: null,
  priority: "normal",
  dueDate: null,
  effortDays: 1,
};

const FIELD_ORDER: CaptureField[] = ["projectId", "ownerId", "priority", "dueDate", "effortDays"];

const SYMBOLS = new Set(["#", "@", "!", "^", "~"]);
const ASCII_WORD = /[A-Za-z0-9_]/;

interface PrefixMatch<T> {
  value: T;
  length: number;
}

/**
 * Reads the explicit token syntax only: #project @owner !priority ^date ~effort.
 * Bare names and dates are left as text, so a title can never be changed by
 * accident just because it contains a word that happens to be a project name.
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

  for (let i = 0; i < raw.length; i++) {
    const symbol = raw[i];
    if (!SYMBOLS.has(symbol)) continue;
    // "C#" and "foo@bar" are text, not tokens. A CJK character before the
    // symbol is fine, so "发给@老李" still works.
    if (i > 0 && ASCII_WORD.test(raw[i - 1])) continue;
    if (spans.some((span) => i >= span.start && i < span.end)) continue;

    let valueStart = i + 1;
    while (valueStart < raw.length && /\s/.test(raw[valueStart])) valueStart++;
    if (valueStart >= raw.length) continue;
    const text = raw.slice(valueStart);
    let end = -1;

    if (symbol === "#") {
      const match = matchName(text, ctx.projects);
      if (!match) continue;
      found.projectId = match.item.id;
      matched.add("projectId");
      end = valueStart + match.length;
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
    } else if (symbol === "^") {
      const match = matchDate(text, ctx.today);
      if (!match) continue;
      found.dueDate = match.value;
      matched.add("dueDate");
      end = valueStart + match.length;
    } else {
      const match = matchEffort(text);
      if (!match) continue;
      found.effortDays = match.value;
      matched.add("effortDays");
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
  };
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

function matchDate(text: string, today: string): PrefixMatch<string> | null {
  const match = matchDatePrefix(text, today);
  if (!match) return null;
  const suffix = /^\s*(?:之前|以前|前)/.exec(text.slice(match.length));
  return suffix ? { value: match.value, length: match.length + suffix[0].length } : match;
}

function matchDatePrefix(text: string, today: string): PrefixMatch<string> | null {
  for (const [pattern, resolve] of dateRules(today)) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = resolve(match, today);
    if (value) return { value, length: match[0].length };
  }
  return null;
}

function dateRules(
  today: string,
): [RegExp, (match: RegExpExecArray, today: string) => string | null][] {
  const year = Number(today.slice(0, 4));
  const fullDate = (match: RegExpExecArray): string | null => {
    const y = Number(match[1]);
    return isoDate(y, Number(match[2]), Number(match[3]));
  };
  const monthDate = (match: RegExpExecArray, baseYear: number): string | null => {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const thisYear = isoDate(baseYear, month, day);
    if (!thisYear) return null;
    if (thisYear >= today) return thisYear;
    return isoDate(baseYear + 1, month, day);
  };
  return [
    [/^大后天/, (_m) => addDays(today, 3)],
    [/^后天/, (_m) => addDays(today, 2)],
    [/^(?:明天|明日)/, (_m) => addDays(today, 1)],
    [/^(?:今天|今日)/, (_m) => today],
    [
      /^(\d{1,3}|[一二两三四五六七八九十])\s*(?:天|日)(?:之后|以后|后|以内|之内|内)/,
      (match) => {
        const days = parseCount(match[1]);
        return days >= 1 && days <= 365 ? addDays(today, days) : null;
      },
    ],
    [
      /^(下下|下个|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/,
      (match) => dateFromWeekday(today, match[2], match[1]),
    ],
    [/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, fullDate],
    [/^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?/, fullDate],
    [/^(\d{1,2})月(\d{1,2})[日号]?/, (match) => monthDate(match, year)],
    [/^(\d{1,2})\/(\d{1,2})(?!\d)/, (match) => monthDate(match, year)],
  ];
}

function dateFromWeekday(today: string, day: string, prefix: string | undefined): string | null {
  const target = "一二三四五六日天".indexOf(day);
  if (target < 0) return null;
  const targetIndex = target >= 6 ? 6 : target;
  const current = weekdayOf(today);
  const mondayOffset = (current + 6) % 7;
  const monday = addDays(today, -mondayOffset);
  let weeks = 0;
  if (prefix === "下" || prefix === "下个") weeks = 1;
  else if (prefix === "下下") weeks = 2;
  let date = addDays(monday, weeks * 7 + targetIndex);
  if (!prefix && date < today) date = addDays(date, 7);
  return date;
}

function matchEffort(text: string): PrefixMatch<number> | null {
  const arabic = /^(\d+(?:\.\d+)?)\s*(?:个工作日|人天|人日|工作日|天|日|days|day|d)/i.exec(text);
  if (arabic) {
    const value = Number(arabic[1]);
    return validEffort(value) ? { value, length: arabic[0].length } : null;
  }
  const chinese = /^(半天|[一二两三四五六七八九十]天)/.exec(text);
  if (chinese) {
    const value = chinese[1] === "半天" ? 0.5 : parseCount(chinese[1][0]);
    return validEffort(value) ? { value, length: chinese[0].length } : null;
  }
  const bare = /^(\d+(?:\.\d+)?)(?=\s|$|[#@!^~])/.exec(text);
  if (bare) {
    const value = Number(bare[1]);
    return validEffort(value) ? { value, length: bare[0].length } : null;
  }
  return null;
}

function validEffort(value: number): boolean {
  return Number.isFinite(value) && value >= 0.5 && value <= 60 && Number.isInteger(value * 2);
}

function parseCount(value: string): number {
  const chinese: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return chinese[value] ?? Number(value);
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}
