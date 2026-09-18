/**
 * The clock, as a reactive source.
 *
 * Anything that renders against "now" — the day-boundary view filters, due-date
 * badges, board cards — must re-read it while the app is open: a session that
 * spans midnight would otherwise keep showing yesterday's 今天 and yesterday's
 * overdue badges. Owning the value here (rather than calling `new Date()` at
 * each site) also keeps every row in one render pass reading the same instant,
 * so a row cannot be filtered as "today" and labelled as "tomorrow".
 *
 * Two triggers, because they cover different stalls: a minute tick for a window
 * that stays visible, and `focus` for the one that did not — a suspended laptop
 * or a hidden window fires late (or throttled) timers, and the user is looking
 * at the screen again the moment it is focused.
 */

import { createSignal, onCleanup } from "solid-js";

/** How often a visible window re-reads the clock. */
const TICK_MS = 60_000;

/**
 * A signal holding the current instant, refreshed on the minute and on window
 * focus. Disposed with its owner, so the interval and the listener go with it.
 */
export function createNow(): () => Date {
  const [now, setNow] = createSignal(new Date());
  const tick = () => setNow(new Date());

  const timer = setInterval(tick, TICK_MS);
  window.addEventListener("focus", tick);
  onCleanup(() => {
    clearInterval(timer);
    window.removeEventListener("focus", tick);
  });

  return now;
}
