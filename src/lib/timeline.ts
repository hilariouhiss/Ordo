export interface TimelineTask {
  id: string;
  title: string;
  expectedStartDate: string | null;
  expectedFinishDate: string | null;
  categoryId: string | null;
  status: string;
}

export interface TimelineRange {
  start: string;
  end: string;
}

export interface TimelineRow {
  taskId: string;
  leftPct: number;
  widthPct: number;
  dashedStart: boolean;
  dashedEnd: boolean;
}

const DAY = 86_400_000;
/** A same-day task would otherwise get a zero-width, invisible bar. */
const MIN_BAR_PCT = 0.6;

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function timelineLayout(range: TimelineRange, tasks: TimelineTask[]): TimelineRow[] {
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  const total = (rangeEnd - rangeStart) / DAY;
  if (total <= 0) return [];

  return (
    tasks
      .filter((task) => task.expectedStartDate || task.expectedFinishDate)
      // A task outside the window has no bar here; drawing it on the edge would read as a
      // date it does not have.
      .filter((task) => {
        const rawStart = task.expectedStartDate ? Date.parse(task.expectedStartDate) : rangeStart;
        const rawEnd = task.expectedFinishDate ? Date.parse(task.expectedFinishDate) : rangeEnd;
        return rawEnd >= rangeStart && rawStart <= rangeEnd;
      })
      .map((task) => {
        const rawStart = task.expectedStartDate ? Date.parse(task.expectedStartDate) : rangeStart;
        const rawEnd = task.expectedFinishDate ? Date.parse(task.expectedFinishDate) : rangeEnd;
        const start = Math.max(rawStart, rangeStart);
        const end = Math.min(rawEnd, rangeEnd);
        return {
          taskId: task.id,
          leftPct: clampPct(((start - rangeStart) / DAY / total) * 100),
          widthPct: clampPct(Math.max(MIN_BAR_PCT, ((end - start) / DAY / total) * 100)),
          dashedStart: !task.expectedStartDate,
          dashedEnd: !task.expectedFinishDate,
        };
      })
  );
}
