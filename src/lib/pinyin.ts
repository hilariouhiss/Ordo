/**
 * ICU's zh collation sorts Han characters by pinyin reading, so bracketing a character between the
 * first character of each initial gives its initial without shipping a 20k-character table.
 * shortcut: one reading per character (曾 reads ceng, not the surname zeng); add a surname table
 * when names like 曾/单/解/仇 keep failing to match here.
 */
const BOUNDS = [
  "阿",
  "八",
  "擦",
  "搭",
  "鹅",
  "发",
  "噶",
  "哈",
  "击",
  "喀",
  "拉",
  "妈",
  "拿",
  "哦",
  "趴",
  "期",
  "然",
  "撒",
  "塔",
  "挖",
  "昔",
  "压",
  "匝",
];
const LETTERS = "abcdefghjklmnopqrstwxyz";
const collator = new Intl.Collator("zh");
const han = /\p{Script=Han}/u;

/** The pinyin initial of one character; latin letters keep themselves, punctuation contributes nothing. */
export function pinyinInitial(char: string): string {
  if (/^[a-z]$/i.test(char)) return char.toLowerCase();
  if (!han.test(char)) return "";
  let low = 0;
  let high = BOUNDS.length - 1;
  let hit = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (collator.compare(BOUNDS[mid], char) <= 0) {
      hit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return hit < 0 ? "" : LETTERS[hit];
}

/**
 * Surnames the collation reads wrong (it takes the everyday reading, not the surname one).
 * Only the first character of a name is looked up here; 万 is left out because 万俟 is far rarer
 * than 万 as wàn.
 */
const SURNAME_INITIALS: Record<string, string> = {
  单: "s",
  曾: "z",
  解: "x",
  仇: "q",
  区: "o",
  查: "z",
  乐: "y",
  尉: "y",
  覃: "q",
  翟: "z",
  繁: "p",
  种: "c",
  折: "s",
  长: "c",
  秘: "b",
  句: "g",
  蔚: "y",
  召: "s",
  会: "k",
  泷: "s",
  澹: "t",
  率: "s",
};

/** "刘雨洁" → "lyj", so typing initials finds a person as well as typing their name. */
export function nameInitials(name: string): string {
  let initials = "";
  let first = true;
  for (const char of name) {
    initials += (first ? SURNAME_INITIALS[char] : undefined) ?? pinyinInitial(char);
    first = false;
  }
  return initials;
}

/** Whether a person's name answers a typed query, by name text or by pinyin initials ("lyj" → 刘雨洁). */
export function matchesName(name: string, query: string): boolean {
  const typed = query.trim().toLowerCase();
  if (!typed) return true;
  return name.toLowerCase().includes(typed) || nameInitials(name).includes(typed);
}
