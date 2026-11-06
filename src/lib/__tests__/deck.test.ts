import { describe, expect, it } from "vite-plus/test";
import { DECK_CARD_W, DECK_MAX_STEP, stackStep } from "../deck";

const rowWidth = (count: number, step: number) => DECK_CARD_W + (count - 1) * step;

describe("stackStep", () => {
  it("keeps the natural overlap while the row has room", () => {
    expect(stackStep(900, 5)).toBe(DECK_MAX_STEP);
    expect(stackStep(900, 1)).toBe(DECK_MAX_STEP);
  });

  it("compresses the stack to fit the row", () => {
    expect(stackStep(600, 5)).toBeCloseTo(85);
    expect(stackStep(600, 30)).toBeCloseTo(340 / 29);
  });

  it("fully stacks when even the cards cannot fit", () => {
    expect(stackStep(200, 5)).toBe(0);
    expect(stackStep(0, 5)).toBe(0);
  });

  it("never lets the row overflow the width it was given", () => {
    for (const available of [200, 600, 900, 1200]) {
      for (const count of [1, 2, 5, 30]) {
        const step = stackStep(available, count);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(rowWidth(count, step)).toBeLessThanOrEqual(Math.max(available, DECK_CARD_W));
      }
    }
  });
});
