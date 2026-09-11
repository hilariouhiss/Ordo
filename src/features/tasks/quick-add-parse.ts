/**
 * The quick-add input grammar (D-02): `@项目`, `!高/!中/!低` and Chinese date
 * phrases, parsed out of the typed line so a capture can be filed completely
 * without leaving the keyboard.
 *
 * Two principles run through all of it:
 *  - **Never guess.** Anything ambiguous — a project prefix that fits two
 *    names, a `@word` that matches nothing, `2月31日` — is left in the title
 *    untouched. A half-parsed title is worse than an unparsed one.
 *  - **Only strip what was understood.** The title is the text minus the
 *    markers that actually resolved, so `等 @张三 回复` keeps its `@张三`.
 */

import { addDays, addWeeks, startOfDay, startOfWeek } from "date-fns";
import { priorityFromLabel } from "./priority";
import type { Priority } from "./types";

/** What the caller needs to build a `NewTask`. `null` = "not mentioned". */
export interface QuickAddParse {
  /** The line with every recognised marker removed and whitespace tidied. */
  title: string;
  projectId: string | null;
  priority: Priority | null;
  dueAt: string | null;
}

/** The slice of a project the marker matcher needs. */
export interface NamedRef {
  id: string;
  name: string;
}

/** Markers accept the full-width forms a Chinese IME produces. */
const AT_SIGN = "[@＠]";
const BANG = "[!！]";
const PROJECT_CANDIDATE = new RegExp(`${AT_SIGN}([^\\s@＠!！]+)`, "g");

const DATE_CORE = [
  "(?<rel>今天|今日|明天|明日|后天|大后天)",
  "|(?<intervalN>\\d+)\\s*(?<intervalUnit>天|周|个?星期)后",
  "|(?:(?<mdYear>\\d{4})\\s*年\\s*)?(?<mdMonth>\\d{1,2})\\s*月\\s*(?<mdDay>\\d{1,2})\\s*[日号]",
  "|(?<weekOffset>下下|下|本|这)?\\s*(?:周|星期|礼拜)\\s*(?<weekDay>[一二三四五六日天])",
].join("");

/** `下午3点半` / `9点15分` / nothing at all — the date alone means end of day. */
const DATE_TIME = [
  "(?:\\s*(?<period>上午|早上|清晨|中午|下午|晚上|傍晚|夜里)?",
  "\\s*(?<hour>\\d{1,2})\\s*点\\s*(?<minute>半|\\d{1,2}\\s*分)?)?",
].join("");

// The core is wrapped in a group on purpose: concatenation binds tighter than
// alternation, so without it the trailing time would only ever attach to the
// last branch (weekday) and `明天下午3点` would silently lose its 3pm.
const DATE_RE = new RegExp(`(?:${DATE_CORE})${DATE_TIME}`);

const REL_DAYS: Record<string, number> = {
  今天: 0,
  今日: 0,
  明天: 1,
  明日: 1,
  后天: 2,
  大后天: 3,
};

const WEEK_OFFSETS: Record<string, number> = { 下下: 2, 下: 1, 本: 0, 这: 0 };

const WEEK_DAYS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

/** Periods that shift a 12-hour clock reading into the afternoon/evening. */
const PM_PERIODS = new Set(["下午", "晚上", "傍晚", "夜里"]);

/** The last second of a local day — the app's convention for a bare date. */
const END_OF_DAY = { hour: 23, minute: 59, second: 59 };

/**
 * Reads `text` against `projects`. `now` is injectable so the date rules are
 * testable and so the caller decides what "today" means.
 */
export function parseQuickAdd(
  text: string,
  projects: readonly NamedRef[],
  now: Date = new Date(),
): QuickAddParse {
  // Projects go first: a project may legitimately be named 明天 or 周五, and
  // the explicit `@` is the stronger signal about which was meant.
  const withProject = takeProject(text, projects);
  const withPriority = takePriority(withProject.rest);
  const withDate = takeDate(withPriority.rest, now);

  return {
    title: withDate.rest.replace(/\s+/g, " ").trim(),
    projectId: withProject.projectId,
    priority: withPriority.priority,
    dueAt: withDate.dueAt,
  };
}

/** `@项目` → the project, and the line without the marker. */
function takeProject(
  text: string,
  projects: readonly NamedRef[],
): { rest: string; projectId: string | null } {
  PROJECT_CANDIDATE.lastIndex = 0;
  for (
    let match = PROJECT_CANDIDATE.exec(text);
    match !== null;
    match = PROJECT_CANDIDATE.exec(text)
  ) {
    const hit = matchProject(match[1], projects);
    if (!hit) continue;
    // Drop only the `@` and the name that matched, so whatever followed the
    // name (`@Work明天`) stays in the line for the date rule to read.
    const start = match.index;
    const end = start + 1 + hit.consumed;
    return { rest: text.slice(0, start) + text.slice(end), projectId: hit.project.id };
  }
  return { rest: text, projectId: null };
}

function matchProject(
  token: string,
  projects: readonly NamedRef[],
): { project: NamedRef; consumed: number } | null {
  const lower = token.toLowerCase();

  // Longest project name the token starts with: Chinese titles rarely put a
  // space after a Latin name, so `@Work明天` has to end the name itself.
  let longest: { project: NamedRef; consumed: number } | null = null;
  for (const project of projects) {
    const name = project.name.toLowerCase();
    if (name && lower.startsWith(name) && (longest === null || name.length > longest.consumed)) {
      longest = { project, consumed: name.length };
    }
  }
  if (longest) return longest;

  // Otherwise a name the user has not finished typing (`@Wor` → Work), but
  // only when exactly one project could be meant.
  const unfinished = projects.filter((project) =>
    project.name.toLowerCase().startsWith(lower),
  );
  return unfinished.length === 1
    ? { project: unfinished[0], consumed: token.length }
    : null;
}

/** `!高` → the priority, and the line without the marker. */
function takePriority(text: string): { rest: string; priority: Priority | null } {
  const match = new RegExp(`${BANG}([高中低])`).exec(text);
  if (!match) return { rest: text, priority: null };
  const priority = priorityFromLabel(match[1]);
  if (!priority) return { rest: text, priority: null };
  return {
    rest: text.slice(0, match.index) + text.slice(match.index + match[0].length),
    priority,
  };
}

/** A Chinese date phrase → the instant it means, and the line without it. */
function takeDate(text: string, now: Date): { rest: string; dueAt: string | null } {
  const match = DATE_RE.exec(text);
  if (!match?.groups) return { rest: text, dueAt: null };

  const day = resolveDay(match.groups, now);
  if (!day) return { rest: text, dueAt: null };
  const time = resolveTime(match.groups);
  if (!time) return { rest: text, dueAt: null };

  const dueAt = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.hour,
    time.minute,
    time.second,
  );
  return {
    rest: text.slice(0, match.index) + text.slice(match.index + match[0].length),
    dueAt: dueAt.toISOString(),
  };
}

/** The calendar day a date phrase lands on; `null` when it is not a real date. */
function resolveDay(groups: Record<string, string | undefined>, now: Date): Date | null {
  const midnight = startOfDay(now);

  if (groups.rel !== undefined) return addDays(midnight, REL_DAYS[groups.rel] ?? 0);

  if (groups.intervalN !== undefined) {
    const count = Number(groups.intervalN);
    const unit = groups.intervalUnit ?? "";
    return unit === "天" ? addDays(midnight, count) : addWeeks(midnight, count);
  }

  if (groups.mdMonth !== undefined) {
    const month = Number(groups.mdMonth);
    const date = Number(groups.mdDay);
    const explicitYear = groups.mdYear !== undefined;
    let year = explicitYear ? Number(groups.mdYear) : now.getFullYear();
    let candidate = new Date(year, month - 1, date);
    // `new Date(2026, 1, 31)` silently becomes 3 March; refuse it instead.
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== date) return null;
    // A date already behind us means next year's, unless one was written out.
    if (!explicitYear && candidate < midnight) {
      year += 1;
      candidate = new Date(year, month - 1, date);
    }
    return candidate;
  }

  if (groups.weekDay !== undefined) {
    const weekday = WEEK_DAYS[groups.weekDay];
    if (weekday === undefined) return null;
    const offset = groups.weekOffset === undefined ? 0 : WEEK_OFFSETS[groups.weekOffset];
    if (offset === undefined) return null;
    const target = addDays(startOfWeek(now, { weekStartsOn: 1 }), offset * 7 + weekday - 1);
    // A bare 周三 on a Thursday means the one coming up, not the one gone by.
    const explicitWeek = groups.weekOffset !== undefined;
    return !explicitWeek && target < midnight ? addWeeks(target, 1) : target;
  }

  return null;
}

/** The clock time a phrase carries; end of day when it names none. */
function resolveTime(
  groups: Record<string, string | undefined>,
): { hour: number; minute: number; second: number } | null {
  if (groups.hour === undefined) return END_OF_DAY;

  let hour = Number(groups.hour);
  if (PM_PERIODS.has(groups.period ?? "") && hour < 12) hour += 12;

  const rawMinute = groups.minute;
  const minute =
    rawMinute === undefined ? 0 : rawMinute === "半" ? 30 : Number(rawMinute.replace(/\D/g, ""));

  if (hour > 23 || minute > 59) return null;
  return { hour, minute, second: 0 };
}
