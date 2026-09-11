/**
 * Snippet parsing for search hits. The backend marks the match window with
 * `<mark>`/`</mark>`; segments are rendered as real elements instead of
 * `innerHTML`, so marker text can never inject markup.
 */

export interface SnippetSegment {
  text: string;
  marked: boolean;
}

const MARK_OPEN = "<mark>";
const MARK_CLOSE = "</mark>";

/** Splits a backend snippet into plain/highlighted segments. An unterminated
 * `<mark>` renders as plain text. */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const push = (text: string, marked: boolean): void => {
    if (text) segments.push({ text, marked });
  };

  let plain = "";
  let i = 0;
  while (i < snippet.length) {
    if (!snippet.startsWith(MARK_OPEN, i)) {
      plain += snippet[i];
      i += 1;
      continue;
    }
    const end = snippet.indexOf(MARK_CLOSE, i + MARK_OPEN.length);
    if (end === -1) {
      plain += snippet.slice(i);
      break;
    }
    push(plain, false);
    plain = "";
    push(snippet.slice(i + MARK_OPEN.length, end), true);
    i = end + MARK_CLOSE.length;
  }
  push(plain, false);
  return segments;
}
