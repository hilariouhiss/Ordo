import { For, createMemo } from "solid-js";
import { format, parse } from "date-fns";

export interface CalendarHeatmapProps {
  /** Local day labels (`yyyy-MM-dd`), oldest first; aligns with `values`. */
  days: string[];
  values: number[];
}

const CELL = 13;
const STEP = 16;
const GUTTER = 26;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
/** Intensity steps above zero (GitHub-style shading). */
const LEVELS = 4;

function localDate(day: string): Date {
  return parse(day, "yyyy-MM-dd", new Date());
}

/**
 * A calendar heatmap of one range's daily activity (PRD 3.1).
 *
 * Columns are weeks (Monday first), rows are weekdays, so the same component
 * reads sensibly for a week, a month or a year. Shading is quantised against
 * the range's own peak and each cell carries a `<title>` tooltip.
 */
export function CalendarHeatmap(props: CalendarHeatmapProps) {
  const peak = createMemo(() => Math.max(1, ...props.values));
  /** Monday-first offset of the first cell, 0..6. */
  const lead = createMemo(() =>
    props.days.length === 0 ? 0 : (localDate(props.days[0]).getDay() + 6) % 7,
  );
  const columns = createMemo(() =>
    Math.max(1, Math.ceil((lead() + props.days.length) / 7)),
  );
  const width = createMemo(() => columns() * STEP + GUTTER);
  const height = 7 * STEP + 4;

  const cells = createMemo(() =>
    props.days.map((day, index) => {
      const value = props.values[index] ?? 0;
      const slot = lead() + index;
      return {
        day,
        value,
        x: GUTTER + Math.floor(slot / 7) * STEP,
        y: Math.floor(slot % 7) * STEP,
        level: value === 0 ? 0 : Math.max(1, Math.ceil((value / peak()) * LEVELS)),
      };
    }),
  );

  const total = createMemo(() => props.values.reduce((sum, value) => sum + value, 0));

  return (
    <div class="flex flex-col gap-2">
      {/* Rendered at its intrinsic cell size and scrolled when the range is
          long: scaling a one-column week up to the panel width would blow the
          cells up to a nonsense size. */}
      <div class="overflow-x-auto">
        <svg
          width={width()}
          height={height}
          role="img"
          aria-label={`日历热力图：${props.days.length} 天，合计 ${total()} 个完成`}
        >
          <For each={WEEKDAYS}>
            {(label, row) => (
              <text
                x={GUTTER - 8}
                y={row() * STEP + CELL - 2}
                text-anchor="end"
                font-size="10"
                fill="var(--subtle-foreground)"
              >
                {row() % 2 === 0 ? label : ""}
              </text>
            )}
          </For>

          <For each={cells()}>
            {(cell) => (
              <rect
                data-day={cell.day}
                data-value={cell.value}
                x={cell.x}
                y={cell.y}
                width={CELL}
                height={CELL}
                rx="3"
                fill={cell.level === 0 ? "var(--border)" : "var(--primary)"}
                fill-opacity={cell.level === 0 ? "1" : String(cell.level / LEVELS)}
                class="transition-opacity hover:opacity-60"
              >
                <title>
                  {format(localDate(cell.day), "M月d日")} · {cell.value} 个完成
                </title>
              </rect>
            )}
          </For>
        </svg>
      </div>

      <div class="flex items-center gap-1 text-xs text-subtle-foreground">
        <span>少</span>
        <For each={Array.from({ length: LEVELS + 1 }, (_, level) => level)}>
          {(level) => (
            <span
              class="size-3 rounded-sm"
              style={{
                "background-color": level === 0 ? "var(--border)" : "var(--primary)",
                opacity: level === 0 ? 1 : level / LEVELS,
              }}
            />
          )}
        </For>
        <span>多</span>
      </div>
    </div>
  );
}
