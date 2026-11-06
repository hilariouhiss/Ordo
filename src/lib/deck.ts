/** The week's bottom stack: card width and the widest gap between card lefts. */
export const DECK_CARD_W = 260;
export const DECK_MAX_STEP = 156;

/**
 * How far apart to place the stacked cards so every task fits one row: as wide as the
 * row allows, never wider than the natural card, and 0 (fully stacked) when even that
 * does not fit. `count - 1` gaps plus one card is exactly the row width.
 */
export function stackStep(available: number, count: number): number {
  if (count < 2) return DECK_MAX_STEP;
  return Math.max(0, Math.min(DECK_MAX_STEP, (available - DECK_CARD_W) / (count - 1)));
}
