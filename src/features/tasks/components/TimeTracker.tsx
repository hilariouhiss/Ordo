import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Pencil, Play, Square, Trash2 } from "lucide-solid";
import { format } from "date-fns";
import { Button, DateField, iconButtonClass } from "../../../common/components";
import {
  createTimeEntry,
  deleteTimeEntry,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "../hooks";
import { getTimeEntries } from "../store";
import { formatClock, formatDuration, fromLocalInputValue, toLocalInputValue } from "../time";
import type { TimeEntry } from "../types";

/*
 * Same recipe as `text-field.tsx`'s input, so the manual-entry row lines up
 * with the buttons and select triggers beside it.
 */
const INPUT_CLASS =
  "h-8 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong focus-ring";

export interface TimeTrackerProps {
  taskId: string;
}

/**
 * Time tracking for one task (TE-01): a start/stop timer with a live clock,
 * a manual entry row (start time + minutes) and the task's entry log with its
 * running total. Every write goes through the optimistic hooks, so the timer
 * state flips instantly and reconciles with the backend's authoritative row.
 */
export function TimeTracker(props: TimeTrackerProps) {
  const entries = createMemo(() => getTimeEntries(props.taskId));
  const running = createMemo(() => entries().find((entry) => entry.endedAt === null));
  const total = createMemo(() =>
    entries().reduce((sum, entry) => sum + entry.duration, 0),
  );

  // One-second tick, alive only while a timer runs.
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!running()) return;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(ticker));
  });

  function elapsed(): number {
    const entry = running();
    if (!entry?.startedAt) return 0;
    return Math.max(0, Math.floor((now() - Date.parse(entry.startedAt)) / 1000));
  }

  const [startValue, setStartValue] = createSignal(toLocalInputValue(new Date()));
  const [minutes, setMinutes] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editMinutes, setEditMinutes] = createSignal("");

  function toggleTimer(): void {
    const entry = running();
    if (entry) void stopTimer(props.taskId, entry.id);
    else void startTimer(props.taskId);
  }

  function addManual(): void {
    const value = Number(minutes());
    if (!Number.isFinite(value) || value <= 0) {
      setError("请输入大于 0 的分钟数");
      return;
    }
    const startedAt = fromLocalInputValue(startValue());
    if (Number.isNaN(startedAt.getTime())) {
      setError("请选择有效的开始时间");
      return;
    }
    setError(null);
    setMinutes("");
    void createTimeEntry(props.taskId, {
      startedAt: startedAt.toISOString(),
      duration: Math.round(value * 60),
    });
  }

  function startEdit(entry: TimeEntry): void {
    setEditingId(entry.id);
    setEditMinutes(String(Math.max(1, Math.round(entry.duration / 60))));
  }

  /** Commits the inline length edit; unparsable input cancels. */
  function commitEdit(entryId: string): void {
    if (editingId() !== entryId) return;
    const value = Number(editMinutes());
    setEditingId(null);
    if (!Number.isFinite(value) || value <= 0) return;
    const duration = Math.round(value * 60);
    const current = entries().find((entry) => entry.id === entryId);
    if (current && duration !== current.duration) {
      void updateTimeEntry(props.taskId, entryId, { duration });
    }
  }

  const startLabel = (entry: TimeEntry): string =>
    entry.startedAt ? format(new Date(entry.startedAt), "MM-dd HH:mm") : "—";

  return (
    <section aria-label="时间记录">
      <div class="flex items-baseline justify-between">
        <h3 class="text-sm font-medium text-foreground">时间记录</h3>
        <span class="text-xs text-subtle-foreground">共 {formatDuration(total())}</span>
      </div>

      <div class="mt-2 flex items-center gap-2">
        <Button size="sm" variant={running() ? "secondary" : "primary"} onClick={toggleTimer}>
          <Show when={running()} fallback={<Play size={14} aria-hidden="true" />}>
            <Square size={14} aria-hidden="true" />
          </Show>
          {running() ? "停止计时" : "开始计时"}
        </Button>
        <Show when={running()}>
          <span class="font-mono text-sm tabular-nums text-muted-foreground">
            {formatClock(elapsed())}
          </span>
        </Show>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <DateField type="datetime-local" value={startValue()}>
          <input
            type="datetime-local"
            aria-label="开始时间"
            class={INPUT_CLASS}
            value={startValue()}
            onInput={(event) => setStartValue(event.currentTarget.value)}
          />
        </DateField>
        <input
          type="number"
          min="1"
          step="1"
          aria-label="时长（分钟）"
          placeholder="分钟"
          class={`${INPUT_CLASS} w-20`}
          value={minutes()}
          onInput={(event) => setMinutes(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter during IME composition belongs to the IME, not to us.
            if (event.key === "Enter" && !event.isComposing) addManual();
          }}
        />
        <Button size="sm" variant="secondary" onClick={addManual}>
          记录
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="mt-1 text-xs text-danger">
          {error()}
        </p>
      </Show>

      <ul class="mt-2 flex flex-col">
        <For each={entries()}>
          {(entry) => (
            <li
              data-entry-id={entry.id}
              class="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
            >
              <span
                class="w-24 shrink-0 text-xs text-subtle-foreground"
                title={entry.startedAt ? new Date(entry.startedAt).toLocaleString() : ""}
              >
                {startLabel(entry)}
              </span>

              <Show
                when={editingId() === entry.id}
                fallback={
                  <span class="flex-1 text-sm text-foreground">
                    <Show
                      when={entry.endedAt === null}
                      fallback={formatDuration(entry.duration)}
                    >
                      <span class="text-muted-foreground">进行中</span>
                    </Show>
                  </span>
                }
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  aria-label="修改时长（分钟）"
                  class={`${INPUT_CLASS} w-20`}
                  value={editMinutes()}
                  onInput={(event) => setEditMinutes(event.currentTarget.value)}
                  onBlur={() => commitEdit(entry.id)}
                  onKeyDown={(event) => {
                    // Enter during IME composition belongs to the IME, not to us.
                    if (event.key === "Enter" && !event.isComposing) commitEdit(entry.id);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              </Show>

              <Show when={entry.endedAt !== null && editingId() !== entry.id}>
                <div class="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    class={iconButtonClass}
                    aria-label={`编辑时长 ${formatDuration(entry.duration)}`}
                    onClick={() => startEdit(entry)}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class={iconButtonClass}
                    aria-label={`删除时间记录 ${formatDuration(entry.duration)}`}
                    onClick={() => void deleteTimeEntry(props.taskId, entry.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </Show>
            </li>
          )}
        </For>
        <Show when={entries().length === 0}>
          <li class="px-2 py-1.5 text-sm text-subtle-foreground">还没有时间记录</li>
        </Show>
      </ul>
    </section>
  );
}
