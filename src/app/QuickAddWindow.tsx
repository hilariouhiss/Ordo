import { createSignal, onCleanup, onMount } from "solid-js";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { DateField, Select, TextField, Toaster } from "../common/components";
import { EVENTS } from "../common/ipc/events";
import { isoToLocalDateValue, localDateValueToIso } from "../common/utils/datetime";
import { loadAll as loadProjects } from "../features/projects/hooks";
import { activeProjects, projectsState } from "../features/projects/store";
import { createTask } from "../features/tasks/hooks";
import { PRIORITY_OPTIONS, priorityLabel } from "../features/tasks/priority";
import { parseQuickAdd } from "../features/tasks/quick-add-parse";
import type { Priority } from "../features/tasks/types";

/**
 * Contents of the standalone `quick-add` window (D-02). The global shortcut
 * surfaces a frameless window holding one line and three controls, so a
 * capture can be filed completely — project, priority, due date — without
 * ever leaving the keyboard or opening the main window.
 *
 * The line carries its own grammar (`quick-add-parse.ts`): `@项目` sets the
 * project, `!高/!中/!低` the priority, and a Chinese date phrase the due date.
 * The controls below are the mouse equivalent, and the preview line states
 * what pressing Enter will actually file — which is also the only guard
 * against the grammar eating a word the user meant as prose.
 *
 * A picked control wins over a marker in the line: the user's last explicit
 * action is the clearer signal, and the preview shows the result either way.
 */

/** A control the user has touched; the key's presence means "chosen". */
interface ManualPick {
  projectId?: string | null;
  priority?: Priority;
  dueAt?: string | null;
}

interface ProjectOption {
  id: string | null;
  name: string;
}

const INBOX: ProjectOption = { id: null, name: "收件箱" };

/**
 * Kobalte identifies a select's options by `optionValue` and reads an empty
 * string as "nothing selected", which would leave the trigger blank instead of
 * showing 收件箱. Project ids are UUIDs, so this cannot collide with one.
 */
const INBOX_VALUE = "inbox";

const HINT = "回车添加 · Esc 关闭 · 任务进入收件箱";

export default function QuickAddWindow() {
  const [title, setTitle] = createSignal("");
  const [manual, setManual] = createSignal<ManualPick>({});
  const [submitting, setSubmitting] = createSignal(false);
  let input: HTMLInputElement | undefined;

  const projectOptions = (): ProjectOption[] => [
    INBOX,
    ...activeProjects().map((project) => ({ id: project.id, name: project.name })),
  ];

  // The line is parsed reactively so the preview can show the interpretation
  // as it is typed; `submit` re-reads the same values, so what was previewed
  // is what gets filed.
  const parsed = () => parseQuickAdd(title(), activeProjects());

  const projectId = (): string | null => {
    const pick = manual();
    return "projectId" in pick ? pick.projectId ?? null : parsed().projectId;
  };
  const priority = (): Priority => manual().priority ?? parsed().priority ?? "none";
  const dueAt = (): string | null => {
    const pick = manual();
    return "dueAt" in pick ? pick.dueAt ?? null : parsed().dueAt;
  };

  const selectedProject = (): ProjectOption =>
    projectOptions().find((option) => option.id === projectId()) ?? INBOX;
  const selectedPriority = () =>
    PRIORITY_OPTIONS.find((option) => option.value === priority()) ?? PRIORITY_OPTIONS[3];

  /** What Enter will file, minus the title; empty when nothing was set. */
  const chips = (): string[] => {
    const parts: string[] = [];
    const project = projectId();
    if (project !== null) {
      parts.push(`项目 ${projectOptions().find((o) => o.id === project)?.name ?? ""}`);
    }
    if (priority() !== "none") parts.push(priorityLabel(priority()));
    const due = dueAt();
    if (due) parts.push(format(new Date(due), "M月d日 HH:mm"));
    return parts;
  };

  const preview = (): string => {
    const parts = chips();
    if (parts.length === 0) return HINT;
    return [parsed().title || "（无标题）", ...parts].join(" · ");
  };

  function reset(): void {
    setTitle("");
    setManual({});
    setSubmitting(false);
  }

  onMount(() => {
    if (!projectsState.loaded) void loadProjects();

    // The backend pings this window every time it shows it. `autofocus` alone
    // is not enough: it fires on page load, and this page was loaded once at
    // startup while the window was still hidden.
    let unlisten: (() => void) | undefined;
    let disposed = false;

    listen(EVENTS.quickAdd, () => {
      reset();
      // Projects can be created or archived while this window sits hidden.
      void loadProjects();
      input?.focus();
    })
      .then((stop) => {
        // The window may already be gone (or there is no Tauri runtime, e.g.
        // the browser dev server), in which case there is nothing to do.
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});

    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  /** Parks this window; nothing to hide outside a Tauri runtime. */
  function hideWindow(): void {
    getCurrentWindow()
      .hide()
      .catch(() => {});
  }

  async function submit(): Promise<void> {
    // The title is the line minus the markers that resolved, so `写周报 @Work`
    // files as 写周报; a line that was nothing but markers has no title left.
    const text = parsed().title;
    if (!text || submitting()) return;

    setSubmitting(true);
    const created = await createTask({
      title: text,
      projectId: projectId(),
      priority: priority(),
      dueAt: dueAt(),
    });
    setSubmitting(false);
    if (!created) return; // hooks notified; keep the line for a retry

    // The main window reads the same database through its own store, which
    // this write is invisible to. Let it refresh.
    await emit(EVENTS.taskCreated).catch(() => {});
    reset();
    hideWindow();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the element IS the window chrome, and Escape is a window-level shortcut rather than an interaction with it
    <div
      // The window is frameless and sized to its content, so this element IS
      // the window chrome: it draws its own hairline edge and fills the whole
      // surface. `dvh`, not `vh`, so the bottom control row cannot be clipped.
      class="flex h-dvh flex-col gap-3 overflow-hidden border border-border bg-surface p-4 text-foreground"
      onKeyDown={(event) => {
        // Escape closes the thing in front. An open dropdown handles it first
        // and marks the key handled (Kobalte's listbox does), and hiding the
        // window on the same press would take the half-typed line with it: the
        // window hides and `reset()` empties the field on the next summon.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        hideWindow();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          // `isComposing` matters: with a Chinese IME the Enter that commits a
          // composition must not file the task, or every Chinese title would
          // be captured half-typed. Implicit submission covers Enter in a real
          // browser, but the explicit path is what the tests and any odd
          // webview rely on; the `submitting()` guard keeps the two from
          // filing twice.
          if (event.key === "Enter" && !event.isComposing) void submit();
        }}
      >
        <TextField.Root>
          <TextField.Input
            ref={(element: HTMLInputElement) => {
              input = element;
            }}
            aria-label="任务标题"
            placeholder="要做点什么？@项目 !高 #明天"
            autofocus
            // This one field is the entire point of the window, so it is set a
            // tier above every other input in the app.
            class="h-10 text-base"
            value={title()}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </TextField.Root>
      </form>

      <div class="flex items-center gap-2">
        <Select.Root
          class="min-w-0 flex-1"
          options={projectOptions()}
          optionValue={(option) => option.id ?? INBOX_VALUE}
          optionTextValue={(option) => option.name}
          itemToString={(option) => option.name}
          value={selectedProject()}
          onChange={(option) => {
            const id = option?.id ?? null;
            // Kobalte fires this once with the initial value, so only a real
            // change counts as a pick: otherwise merely opening the window
            // would register 收件箱 and outrank the line's `@项目`.
            if (id === projectId()) return;
            setManual({ ...manual(), projectId: id });
          }}
        >
          <Select.Label class="sr-only">项目</Select.Label>
          <Select.Trigger class="w-full">
            <Select.Value>{selectedProject().name}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <Select.Root
          class="w-24 shrink-0"
          options={PRIORITY_OPTIONS}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedPriority()}
          onChange={(option) => {
            const value = option?.value ?? "none";
            if (value === priority()) return; // see the project select above
            setManual({ ...manual(), priority: value });
          }}
        >
          <Select.Label class="sr-only">优先级</Select.Label>
          <Select.Trigger class="w-full">
            <Select.Value>{selectedPriority().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <TextField.Root
          class="w-36 shrink-0"
          value={isoToLocalDateValue(dueAt())}
          onChange={(value) => {
            if (value === isoToLocalDateValue(dueAt())) return; // see the project select above
            setManual({ ...manual(), dueAt: localDateValueToIso(value) });
          }}
        >
          <DateField type="date" value={isoToLocalDateValue(dueAt())}>
            <TextField.Input type="date" aria-label="截止日期" />
          </DateField>
        </TextField.Root>
      </div>

      <p
        role="status"
        aria-live="polite"
        class="min-h-4 truncate text-xs text-subtle-foreground"
      >
        {preview()}
      </p>

      <Toaster />
    </div>
  );
}
