import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the project root, so the tree is resolved from there.
const SRC = join(process.cwd(), "src");

/*
 * The animation rules are design constraints (ARCHITECTURE §2.6, ADR 5, and the
 * 动效 row of the non-functional targets), which means they are exactly the kind
 * of claim that quietly stops being true. No linter covers them, so they are
 * asserted against the source here: the checks one review pass would make by
 * hand, kept runnable.
 *
 * The one thing worth knowing before editing these: the allow-lists are
 * deliberately closed. Adding a property or a duration means editing a rule
 * here in the same commit, which is the point.
 */

/** Every `.ts`/`.tsx` source file under `src/`, tests excluded, as raw text. */
const sources = Object.entries(
  import.meta.glob("../../**/*.{ts,tsx}", {
    query: "?raw",
    eager: true,
    import: "default",
  }) as Record<string, string>,
)
  .filter(([path]) => !path.includes("__tests__"))
  .map(([path, text]) => ({ file: path.replace("../../", "/"), text }));


// Read off disk, not imported: the CSS pipeline in the test environment
// replaces style imports with empty strings (see `node-fs.d.ts`).
const css = readFileSync(join(SRC, "index.css"), "utf8");

/** Every line of every source file matching `pattern`, as `file:line text`. */
function matchingLines(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const { file, text } of sources) {
    text.split("\n").forEach((line, index) => {
      if (pattern.test(line)) hits.push(`src${file}:${index + 1} ${line.trim()}`);
    });
  }
  return hits;
}

describe("animation constraints", () => {
  it("keeps animation out of JavaScript and inside index.css", () => {
    // A rAF loop or a Web Animations call is how an animation library gets
    // reinvented; the rule is CSS transitions/animations only.
    expect(matchingLines(/requestAnimationFrame|\.animate\(|KeyframeEffect/)).toEqual([]);
    // Keyframes live in exactly one file, so `prefers-reduced-motion` has
    // exactly one place to reach them from.
    expect(matchingLines(/@keyframes|animation-name\s*:/)).toEqual([]);
  });

  it("only transitions compositor-friendly properties", () => {
    // `transition` is Tailwind's colour/decoration default set, and the
    // `transition-<property>` utilities name one property each. `width` is the
    // one deliberate exception — the sidebar rail (AppShell) — and the only
    // layout property allowed to move; the animation rules in
    // `docs/ARCHITECTURE.md`§2.6 and the 动效 row of the non-functional targets
    // carry the same exception, so a second one means updating all three.
    const allowed = new Set([
      "color",
      "background-color",
      "border-color",
      "outline-color",
      "text-decoration-color",
      "fill",
      "stroke",
      "opacity",
      "transform",
      "width",
    ]);
    // Each token is read as the set of properties Tailwind's utility of that
    // name actually transitions; anything that is not a property name (a bare
    // `transition-all`) fails.
    const COLOR_SET = [
      "color",
      "background-color",
      "border-color",
      "outline-color",
      "text-decoration-color",
      "fill",
      "stroke",
    ];
    const sets: Record<string, string[]> = {
      transition: COLOR_SET,
      "transition-colors": COLOR_SET,
      "transition-opacity": ["opacity"],
      "transition-transform": ["transform"],
      "transition-[width]": ["width"],
    };
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      text.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/(?<![\w-])transition(?:-[\w[\]]+)?/g)) {
          const properties = sets[match[0]];
          if (!properties || properties.some((property) => !allowed.has(property))) {
            offenders.push(`src${file}:${index + 1} ${line.trim()}`);
          }
        }
      });
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("only animates opacity, scale, translate or transform", () => {
    const allowed = new Set(["opacity", "scale", "translate", "transform"]);
    const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBeGreaterThan(0);
    for (const [, name, body] of keyframes) {
      for (const property of body.matchAll(/^\s*([a-z-]+)\s*:/gm)) {
        // `background-position` was the old skeleton sweep: it repaints the
        // element on every frame, which is what the rule exists to prevent.
        expect(allowed, `${name} animates ${property[1]}`).toContain(property[1]);
      }
    }
  });

  it("keeps micro-interaction durations inside the 150–300ms band", () => {
    const outside: string[] = [];
    for (const { file, text } of sources) {
      text.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(/duration-(\d+)/g)) {
          const value = Number(match[1]);
          if (value < 150 || value > 300) outside.push(`src${file}:${index + 1} ${line.trim()}`);
        }
      });
    }
    // Entry animations are micro-interactions too. The skeleton sweep loops for
    // as long as the data takes, so it is not on this clock.
    for (const match of css.matchAll(/animation:\s*[\w-]+\s+(\d+)ms([^;]*);/g)) {
      const value = Number(match[1]);
      if (!match[2].includes("infinite") && (value < 150 || value > 300)) {
        outside.push(`src/index.css ${match[0]}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it("neutralizes motion globally when the system asks for less of it", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, at + 400);
    expect(rule).toContain("animation-duration");
    expect(rule).toContain("transition-duration");
  });
});
