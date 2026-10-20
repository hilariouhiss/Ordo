export interface TimelineTask {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string | null;
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

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function timelineLayout(range: TimelineRange, tasks: TimelineTask[]): TimelineRow[] {
  const total = days(range.start, range.end);
  if (total <= 0) return [];

  return tasks
    .filter((task) => task.startDate || task.dueDate)
    .map((task) => {
      const start = task.startDate ?? range.start;
      const end = task.dueDate ?? task.startDate ?? range.end;
      const leftPct = clampPct((days(range.start, start) / total) * 100);
      const widthPct = clampPct((days(start, end) / total) * 100);
      return {
        taskId: task.id,
        leftPct,
        widthPct,
        dashedStart: !task.startDate,
        dashedEnd: !task.dueDate,
      };
    });
}
