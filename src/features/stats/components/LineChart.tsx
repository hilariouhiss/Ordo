import { For, Show, createMemo } from "solid-js";

export interface LineChartProps {
  /** Bucket labels, oldest first; must align with `values`. */
  keys: string[];
  values: number[];
  /** Axis tick label for a bucket key. */
  formatKey: (key: string) => string;
  /** Readout for gridlines and point tooltips. */
  formatValue: (value: number) => string;
  /** Describes the series for assistive tech. */
  label: string;
}

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 12, right: 16, bottom: 24, left: 48 };
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;
const AXIS_TICKS = 3;

/** Smallest 1/2/5×10ⁿ step that is at least `value` — keeps ticks round. */
function niceStep(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

/**
 * A hand-drawn line chart (no chart library, per the plan's size budget).
 *
 * Purely presentational: the caller hands over an already zero-filled series.
 * Interaction is CSS-only — every point carries a `<title>` tooltip and a
 * hoverable dot — so a range switch cannot jank on layout work here.
 */
export function LineChart(props: LineChartProps) {
  const max = createMemo(() => {
    const step = niceStep(Math.max(...props.values, 1) / AXIS_TICKS);
    return step * AXIS_TICKS;
  });
  const x = (index: number): number =>
    PAD.left +
    (props.values.length <= 1
      ? 0
      : (index / (props.values.length - 1)) * PLOT_WIDTH);
  const y = (value: number): number =>
    PAD.top + PLOT_HEIGHT - (value / max()) * PLOT_HEIGHT;
  const baseline = PAD.top + PLOT_HEIGHT;

  const line = createMemo(() =>
    props.values.map((value, index) => `${x(index)},${y(value)}`).join(" "),
  );
  const area = createMemo(() => {
    if (props.values.length <= 1) return "";
    const points = props.values
      .map((value, index) => `L ${x(index)},${y(value)}`)
      .join(" ");
    return `M ${x(0)},${baseline} ${points} L ${x(props.values.length - 1)},${baseline} Z`;
  });
  const ticks = createMemo(() =>
    Array.from(
      { length: AXIS_TICKS + 1 },
      (_, index) => (max() / AXIS_TICKS) * index,
    ),
  );

  /** First, middle and last bucket labels — enough to read the axis. */
  const axisLabels = createMemo(() => {
    if (props.keys.length === 0) return [];
    const last = props.keys.length - 1;
    return [...new Set([0, Math.floor(last / 2), last])].map((index) => ({
      index,
      text: props.formatKey(props.keys[index]),
    }));
  });

  const summary = createMemo(() => {
    const total = props.values.reduce((sum, value) => sum + value, 0);
    return `${props.label}：${props.values.length} 个数据点，合计 ${props.formatValue(total)}`;
  });

  return (
    <div class="overflow-x-auto">
      {/* The viewBox scales with the panel, but never below the width where
          the axis labels stay readable. */}
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        class="h-auto w-full min-w-[560px] max-w-4xl"
        role="img"
        aria-label={summary()}
      >
        <For each={ticks()}>
          {(tick) => (
            <>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                stroke-width="1"
              />
              <text
                x={PAD.left - 8}
                y={y(tick) + 4}
                text-anchor="end"
                font-size="11"
                fill="var(--subtle-foreground)"
              >
                {props.formatValue(tick)}
              </text>
            </>
          )}
        </For>

        <Show when={props.values.length > 1}>
          <path d={area()} fill="var(--primary)" fill-opacity="0.10" />
        </Show>

        <polyline
          points={line()}
          fill="none"
          stroke="var(--primary)"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          /* The viewBox scales with the panel; without this the line thickens
             with it and stops matching the 1px gridlines. */
          vector-effect="non-scaling-stroke"
        />

        <For each={props.values}>
          {(value, index) => (
            <circle
              cx={x(index())}
              cy={y(value)}
              r="2.5"
              fill="var(--primary)"
              class="transition-opacity hover:opacity-60"
            >
              <title>
                {props.formatKey(props.keys[index()] ?? "")} ·{" "}
                {props.formatValue(value)}
              </title>
            </circle>
          )}
        </For>

        <For each={axisLabels()}>
          {(tick) => (
            <text
              x={x(tick.index)}
              y={HEIGHT - 6}
              text-anchor={
                tick.index === 0
                  ? "start"
                  : tick.index === props.keys.length - 1
                    ? "end"
                    : "middle"
              }
              font-size="11"
              fill="var(--subtle-foreground)"
            >
              {tick.text}
            </text>
          )}
        </For>
      </svg>
    </div>
  );
}
