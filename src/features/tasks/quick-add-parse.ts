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

import { addDays, addMonths, addWeeks, startOfDay, startOfMonth, startOfWeek } from "date-fns";
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
const HASH = "[#＃]";
const PROJECT_CANDIDATE = new RegExp(`${AT_SIGN}([^\\s@＠!！#＃]+)`, "g");
const DATE_MARKER = new RegExp(HASH, "g");

// Order matters. The numeric form is first because it is the most specific;
// `md` (9月30日) sits ahead of the month edge so that a spelled-out day always
// beats the 底/初/中 reading of the same 月.
const DATE_CORE = [
  "(?:(?<numYear>\\d{4})\\s*[/-]\\s*)?(?<numMonth>\\d{1,2})\\s*[/-]\\s*(?<numDay>\\d{1,2})",
  "|(?<rel>今天|今日|明天|明日|后天|大后天)",
  "|(?<intervalN>\\d+)\\s*(?<intervalUnit>天|周|个?星期)后",
  "|(?:(?<mdYear>\\d{4})\\s*年\\s*)?(?<mdMonth>\\d{1,2})\\s*月\\s*(?<mdDay>\\d{1,2})\\s*[日号]",
  "|(?<weekOffset>下下|下|本|这)?\\s*(?:周|星期|礼拜)\\s*(?<weekDay>[一二三四五六日天])",
  // 月底 / 本月底 / 下个月底 / 3月底 — the 月 belongs to the edge word, so it
  // carries no year and no day of its own.
  "|(?<monthRef>下下|下个|下|这个|这|本)?\\s*个?\\s*(?<edgeMonth>\\d{1,2})?\\s*月\\s*(?<monthKind>底|初|中)",
  // 年底 / 今年底 / 明年底 / 2028年底. `今年` already ends in 年, hence the
  // three-way choice rather than an optional prefix.
  "|(?:(?<yearRef>今年|明年|本年)|(?<edgeYear>\\d{4})年|年)\\s*(?<yearKind>底|初|中)",
  // 周末 / 本周末 / 下周末 — the Sunday that closes the named week.
  "|(?:(?<weekendRef>下下|下个|下|这个|这|本)\\s*)?(?<weekend>周末)",
].join("");

/** `下午3点半` / `9点15分` / nothing at all — the date alone means end of day. */
const DATE_TIME = [
  "(?:\\s*(?<period>上午|早上|清晨|中午|下午|晚上|傍晚|夜里)?",
  "\\s*(?<hour>\\d{1,2})\\s*点\\s*(?<minute>半|\\d{1,2}\\s*分)?)?",
].join("");

// The core is wrapped in a group on purpose: concatenation binds tighter than
// alternation, so without it the trailing time would only ever attach to the
// last branch (weekday) and `#明天下午3点` would silently lose its 3pm. It is
// anchored because a date only counts immediately after its `#`.
const DATE_RE = new RegExp(`^(?:${DATE_CORE})${DATE_TIME}`);

const REL_DAYS: Record<string, number> = {
  今天: 0,
  今日: 0,
  明天: 1,
  明日: 1,
  后天: 2,
  大后天: 3,
};

/**
 * How far ahead a period word points, shared by weeks, months and weekends:
 * `下周` and `下个月` are both "the next one". A missing word (a bare 周末)
 * means the current period, and then rolls forward if it has already passed.
 */
const PERIOD_OFFSETS: Record<string, number> = {
  下下: 2,
  下个: 1,
  下: 1,
  这个: 0,
  这: 0,
  本: 0,
};

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

/**
 * `#日期` → the instant it means, and the line without the marker.
 *
 * Every `#` is tried in turn, because one that reads as nothing (`issue #123`,
 * `C#`) has to stay in the title — and must not stop a later `#明天` from
 * being read.
 */
function takeDate(text: string, now: Date): { rest: string; dueAt: string | null } {
  DATE_MARKER.lastIndex = 0;
  for (
    let marker = DATE_MARKER.exec(text);
    marker !== null;
    marker = DATE_MARKER.exec(text)
  ) {
    const match = DATE_RE.exec(text.slice(marker.index + 1));
    if (!match?.groups) continue;

    const day = resolveDay(match.groups, now);
    if (!day) continue;
    const time = resolveTime(match.groups);
    if (!time) continue;

    const dueAt = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      time.hour,
      time.minute,
      time.second,
    );
    return {
      rest: text.slice(0, marker.index) + text.slice(marker.index + 1 + match[0].length),
      dueAt: dueAt.toISOString(),
    };
  }
  return { rest: text, dueAt: null };
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

  // 9月30日 and 9/30 say the same thing; only the spelling differs.
  if (groups.mdMonth !== undefined || groups.numMonth !== undefined) {
    const spelled = groups.mdMonth !== undefined;
    const yearText = spelled ? groups.mdYear : groups.numYear;
    return calendarDate(
      Number(yearText ?? now.getFullYear()),
      Number(spelled ? groups.mdMonth : groups.numMonth),
      Number(spelled ? groups.mdDay : groups.numDay),
      // A date already behind us means next year's, unless one was written out.
      yearText === undefined,
      midnight,
    );
  }

  if (groups.weekDay !== undefined) {
    const weekday = WEEK_DAYS[groups.weekDay];
    if (weekday === undefined) return null;
    const offset = periodOffset(groups.weekOffset);
    if (offset === undefined) return null;
    const target = addDays(startOfWeek(now, { weekStartsOn: 1 }), offset * 7 + weekday - 1);
    // A bare 周三 on a Thursday means the one coming up, not the one gone by.
    const explicitWeek = groups.weekOffset !== undefined;
    return !explicitWeek && target < midnight ? addWeeks(target, 1) : target;
  }

  if (groups.monthKind !== undefined) {
    const kind = groups.monthKind;
    const explicitMonth = groups.edgeMonth;
    const named = groups.monthRef !== undefined;

    let year = now.getFullYear();
    let month = now.getMonth();
    if (explicitMonth !== undefined) {
      month = Number(explicitMonth) - 1;
      if (month < 0 || month > 11) return null; // 13月底 is not a month
    } else if (named) {
      const base = addMonths(startOfMonth(now), periodOffset(groups.monthRef) ?? 0);
      year = base.getFullYear();
      month = base.getMonth();
    }

    const candidate = new Date(year, month, monthEdgeDay(year, month, kind));
    if (named || candidate >= midnight) return candidate;
    // Bare 月初 said on the 20th belongs to next month, not to a month already
    // under way; a spelled-out month instead waits for next year, exactly as
    // `9月1日` does.
    if (explicitMonth !== undefined) return new Date(year + 1, month, monthEdgeDay(year + 1, month, kind));
    const next = addMonths(startOfMonth(now), 1);
    const nextYear = next.getFullYear();
    const nextMonth = next.getMonth();
    return new Date(nextYear, nextMonth, monthEdgeDay(nextYear, nextMonth, kind));
  }

  if (groups.yearKind !== undefined) {
    const kind = groups.yearKind;
    // 底 = 31 December, 中 = 1 July, 初 = 1 January.
    const month = kind === "底" ? 11 : kind === "中" ? 6 : 0;
    const day = kind === "底" ? 31 : 1;
    const named = groups.yearRef !== undefined || groups.edgeYear !== undefined;

    let year = groups.edgeYear !== undefined
      ? Number(groups.edgeYear)
      : groups.yearRef === "明年"
        ? now.getFullYear() + 1
        : now.getFullYear();

    const candidate = new Date(year, month, day);
    if (named || candidate >= midnight) return candidate;
    year += 1; // a bare 年初/年中/年底 means the one coming up
    return new Date(year, month, day);
  }

  if (groups.weekend !== undefined) {
    const offset = periodOffset(groups.weekendRef);
    if (offset === undefined) return null;
    // Sunday closes the week, so that is the day 「周末前搞定」 means.
    const sunday = addDays(startOfWeek(now, { weekStartsOn: 1 }), offset * 7 + 6);
    return groups.weekendRef === undefined && sunday < midnight ? addWeeks(sunday, 1) : sunday;
  }

  return null;
}

/** `下`/`下个`/`下下` → 1/1/2 periods ahead; absent → 0; unknown → undefined. */
function periodOffset(word: string | undefined): number | undefined {
  return word === undefined ? 0 : PERIOD_OFFSETS[word];
}

/**
 * A written month/day (however spelled) → its local midnight; `null` when it
 * is not a real date. `mayRollOver` is the "no year written" case: a date
 * already behind us means next year's.
 */
function calendarDate(
  year: number,
  month: number,
  day: number,
  mayRollOver: boolean,
  midnight: Date,
): Date | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const candidate = new Date(year, month - 1, day);
  // `new Date(2026, 1, 31)` silently becomes 3 March; refuse it instead.
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  if (mayRollOver && candidate < midnight) return new Date(year + 1, month - 1, day);
  return candidate;
}

/** 底 is the month's real last day, so February answers 28 or 29 on its own. */
function monthEdgeDay(year: number, month: number, kind: string): number {
  if (kind === "初") return 1;
  if (kind === "中") return 15;
  return new Date(year, month + 1, 0).getDate();
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
