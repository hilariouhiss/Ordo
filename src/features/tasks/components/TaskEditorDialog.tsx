import { For, Show, createEffect, createMemo, createSignal, createUniqueId, on } from "solid-js";
import { Settings2 } from "lucide-solid";
import { z } from "zod";
import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  Select,
  TextField,
} from "../../../common/components";
import {
  isoToLocalInputValue,
  localInputValueToIso,
} from "../../../common/utils/datetime";
import { activeProjects } from "../../projects/store";
import { createTask, updateTask } from "../hooks";
import {
  COMPLEXITY_OPTIONS,
  complexityFromOption,
  complexityOptionValue,
} from "../complexity";
import { PRIORITY_OPTIONS } from "../priority";
import { REPEAT_FREQ_OPTIONS, REPEAT_FREQ_UNITS } from "../repeat";
import { canAcceptChild } from "../hierarchy";
import { getTag, getTask, hasChildren, tasks, tasksState } from "../store";
import type { Priority, RepeatFreq, RepeatRule, Task } from "../types";
import { TagManagerDialog } from "./TagManagerDialog";

/**
 * Create/edit task dialog (T-04). One component covers both modes: pass
 * `task` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the
 * form open and surface a notification (handled by the hooks).
 */

/** The 父任务 picker's "no parent" row. Kobalte reads `""` back as "nothing is
 * selected" and paints the trigger blank, so the sentinel is a real string. */
const NO_PARENT = { id: null as string | null, name: "（顶层任务）" };

/** The 所属项目 picker's "no project" row: the same word the inbox view and the
 * quick-add window use for a task that belongs to no project. */
const INBOX = { id: null as string | null, name: "收件箱" };

const formSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空"),
  dueLocal: z
    .string()
    .refine(
      (value) => value === "" || !Number.isNaN(new Date(value).getTime()),
      "截止时间无效",
    ),
});

type FormField = "title" | "dueLocal" | "repeatInterval";

export interface TaskEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task to edit; omit to create a new one. */
  task?: Task;
  /** Project assigned to newly created tasks (project detail view); */
  defaultProjectId?: string;
}

export function TaskEditorDialog(props: TaskEditorDialogProps) {
  const titleId = createUniqueId();
  const [title, setTitle] = createSignal("");
  const [note, setNote] = createSignal("");
  const [priority, setPriority] = createSignal<Priority>("none");
  const [complexity, setComplexity] = createSignal<number | null>(null);
  const [dueLocal, setDueLocal] = createSignal("");
  const [tagIds, setTagIds] = createSignal<string[]>([]);
  const [repeatFreq, setRepeatFreq] = createSignal<RepeatFreq | "none">("none");
  const [repeatInterval, setRepeatInterval] = createSignal("1");
  const [repeatPaused, setRepeatPaused] = createSignal(false);
  const [parentId, setParentId] = createSignal<string | null>(null);
  const [projectId, setProjectId] = createSignal<string | null>(null);
  const [managerOpen, setManagerOpen] = createSignal(false);
  const [errors, setErrors] = createSignal<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = createSignal(false);
  let titleRef: HTMLInputElement | undefined;

  // Re-seed the form whenever the dialog (re)opens or switches task.
  createEffect(
    on(
      () => [props.open, props.task] as const,
      ([open, task]) => {
        if (!open) return;
        setTitle(task?.title ?? "");
        setNote(task?.note ?? "");
        setPriority(task?.priority ?? "none");
        setComplexity(task?.complexity ?? null);
        setDueLocal(isoToLocalInputValue(task?.dueAt ?? null));
        setTagIds(task ? [...task.tagIds] : []);
        setRepeatFreq(task?.repeatRule?.freq ?? "none");
        setRepeatInterval(String(task?.repeatRule?.interval ?? 1));
        setRepeatPaused(task?.repeatRule?.paused ?? false);
        setParentId(task?.parentTaskId ?? null);
        setProjectId(task?.projectId ?? props.defaultProjectId ?? null);
        setManagerOpen(false);
        setErrors({});
        setSubmitting(false);
      },
    ),
  );

  /**
   * Parents a task may be filed under: top-level tasks only (the hierarchy is
   * one level, so a child can never be a parent), minus the task being edited —
   * a task is not its own parent. The sentinel keeps the picker able to say
   * 「顶层任务」, which is what `null` means.
   *
   * An existing task is answered by `canAcceptChild`, the same rule the drop
   * target applies, so the picker never offers a write the service refuses. Its
   * current parent stays listed although moving there is a no-op: the picker is
   * seeded with it, and dropping it would paint 「顶层任务」 over a row that still
   * points at it. A task that does not exist yet has no children and no parent
   * to collide with, so for it only the top-level rule above applies.
   */
  const parentOptions = createMemo(() => {
    const editing = props.task;
    return [
      NO_PARENT,
      ...tasks()
        .filter(
          (item) =>
            item.parentTaskId === null &&
            (item.id === editing?.parentTaskId ||
              editing === undefined ||
              canAcceptChild(editing.id, item)),
        )
        .map((item) => ({ id: item.id as string | null, name: item.title })),
    ];
  });
  /** `tasks::has_children` refuses a task that has children (recycle bin
   * included) as someone else's child, so the picker goes out of action rather
   * than offering targets the save would reject. */
  const parentLocked = () => props.task !== undefined && hasChildren(props.task.id);
  const selectedParent = () =>
    parentOptions().find((option) => option.id === parentId()) ?? NO_PARENT;

  /**
   * Projects a task may be filed into, plus 收件箱 for "none". This picker is the
   * keyboard path to R7b: the drag gesture (drop a task on a sidebar project row)
   * used to be the only writer of a task's project, which left the inbox empty
   * state's 「随时可以把它们分配到项目里」 impossible without a mouse.
   */
  const projectOptions = () => [
    INBOX,
    ...activeProjects().map((project) => ({ id: project.id as string | null, name: project.name })),
  ];
  /** Where the task will actually land: a child lives in its parent's project,
   * so a picked parent answers this instead of the picker. */
  const resolvedProjectId = () =>
    parentId() === null
      ? projectId()
      : (getTask(parentId() as string)?.projectId ?? null);
  const selectedProject = () =>
    projectOptions().find((option) => option.id === resolvedProjectId()) ?? INBOX;

  const selectedPriority = () =>
    PRIORITY_OPTIONS.find((option) => option.value === priority()) ??
    PRIORITY_OPTIONS[PRIORITY_OPTIONS.length - 1];

  const selectedComplexity = () =>
    COMPLEXITY_OPTIONS.find((option) => option.value === complexityOptionValue(complexity())) ??
    COMPLEXITY_OPTIONS[0];

  const selectedRepeatOption = () =>
    REPEAT_FREQ_OPTIONS.find((option) => option.value === repeatFreq()) ??
    REPEAT_FREQ_OPTIONS[0];

  const repeatUnit = () => {
    const freq = repeatFreq();
    return REPEAT_FREQ_UNITS[freq === "none" ? "daily" : freq];
  };

  const toggleTag = (id: string) => {
    setTagIds((ids) =>
      ids.includes(id) ? ids.filter((tagId) => tagId !== id) : [...ids, id],
    );
  };

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = formSchema.safeParse({ title: title(), dueLocal: dueLocal() });
    if (!parsed.success) {
      const next: Partial<Record<FormField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FormField;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    let repeatRule: RepeatRule | null = null;
    const freq = repeatFreq();
    if (freq !== "none") {
      const interval = Number(repeatInterval());
      if (!Number.isInteger(interval) || interval < 1) {
        setErrors({ ...errors(), repeatInterval: "间隔需为不小于 1 的整数" });
        return;
      }
      repeatRule = { freq, interval, paused: repeatPaused() };
    }

    setErrors({});
    setSubmitting(true);
    try {
      const noteValue = note().trim() ? note().trim() : null;
      // A child lives inside its parent's project (the backend enforces it), so
      // a picked parent brings its project along instead of leaving the task in
      // the view it was created from.
      const projectId = resolvedProjectId();
      // Sparse patch: re-opening the dialog must not re-send the parent it was
      // seeded with, and an untouched edit must not read as 「move to top level」.
      const parentPatch =
        parentId() === (props.task?.parentTaskId ?? null) ? {} : { parentTaskId: parentId() };
      const payload = {
        title: parsed.data.title,
        note: noteValue,
        priority: priority(),
        complexity: complexity(),
        projectId,
        dueAt: localInputValueToIso(parsed.data.dueLocal),
        // Only tags that still exist: 管理标签 opens from inside this dialog, so
        // a picked tag can be deleted before the form is submitted. Its chip
        // disappears with it while `tagIds` keeps a copy the user has no way to
        // untick, and the backend rejects the whole write with `标签 … 不存在`.
        tagIds: tagIds().filter((id) => getTag(id) !== undefined),
        repeatRule,
        ...parentPatch,
      };
      const result = props.task
        ? await updateTask(props.task.id, payload)
        : await createTask(payload);
      if (result) props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-labelledby={titleId}
          // R12: opening the dialog focuses the title, the first field both
          // modes touch. The focus is taken HERE, in the event Kobalte fires
          // from the mounted content — not in an effect on `open`, which
          // flips before the portal mounts, so the ref is still unset there
          // and the focus silently no-ops (every real open is that flip).
          // Preventing the default also keeps Kobalte's own open-focus off
          // the first tabbable, which here is the close button.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef?.focus();
          }}
        >
          <Dialog.Title id={titleId}>
            {props.task ? "编辑任务" : "新建任务"}
          </Dialog.Title>
          <Dialog.Description>
            {props.task ? "修改任务内容后保存" : "填写任务内容，标题必填"}
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form
            noValidate
            class="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            onSubmit={handleSubmit}
          >
            <TextField.Root
              value={title()}
              onChange={(value) => {
                setTitle(value);
                if (errors().title) setErrors({ ...errors(), title: undefined });
              }}
              validationState={errors().title ? "invalid" : "valid"}
            >
              <TextField.Label>标题</TextField.Label>
              <TextField.Input
                ref={(el: HTMLInputElement) => {
                  titleRef = el;
                }}
                placeholder="例如：写周报"
              />
              <TextField.ErrorMessage>{errors().title ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <TextField.Root value={note()} onChange={setNote}>
              <TextField.Label>备注</TextField.Label>
              <TextField.TextArea placeholder="补充说明（可选）" />
            </TextField.Root>

            <Select.Root
              options={parentOptions()}
              disabled={parentLocked()}
              optionValue={(option) => option.id ?? "none"}
              optionTextValue={(option) => option.name}
              itemToString={(option) => option.name}
              value={selectedParent()}
              onChange={(option) => {
                // Kobalte fires onChange once on mount with the seeded value;
                // treating that as a pick would re-file the task on render.
                const id = option?.id ?? null;
                if (id === parentId()) return;
                setParentId(id);
              }}
            >
              <Select.Label>父任务</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedParent().name}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
              {/* The service's own wording for this refusal, so a locked picker
                  explains itself in the words a rejected save would use. */}
              <Show when={parentLocked()}>
                <Select.Description>
                  该任务还有子任务（含回收站中的），不能变成别人的子任务
                </Select.Description>
              </Show>
            </Select.Root>

            <Select.Root
              options={projectOptions()}
              disabled={parentId() !== null}
              optionValue={(option) => option.id ?? "none"}
              optionTextValue={(option) => option.name}
              itemToString={(option) => option.name}
              value={selectedProject()}
              onChange={(option) => {
                // Kobalte fires onChange once on mount with the seeded value;
                // treating that as a pick would re-file the task on render.
                const id = option?.id ?? null;
                if (id === projectId()) return;
                setProjectId(id);
              }}
            >
              <Select.Label>所属项目</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedProject().name}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
              <Show when={parentId() !== null}>
                <Select.Description>子任务跟随父任务所属项目</Select.Description>
              </Show>
            </Select.Root>

            <Select.Root
              options={PRIORITY_OPTIONS}
              optionValue={(option) => option.value}
              optionTextValue={(option) => option.label}
              itemToString={(option) => option.label}
              value={selectedPriority()}
              onChange={(option) => setPriority(option?.value ?? "none")}
            >
              <Select.Label>优先级</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedPriority().label}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select.Root>

            <Select.Root
              options={COMPLEXITY_OPTIONS}
              optionValue={(option) => option.value}
              optionTextValue={(option) => option.label}
              itemToString={(option) => option.label}
              value={selectedComplexity()}
              onChange={(option) => setComplexity(complexityFromOption(option?.value ?? "none"))}
            >
              <Select.Label>复杂度</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedComplexity().label}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select.Root>

            <TextField.Root
              value={dueLocal()}
              onChange={(value) => {
                setDueLocal(value);
                if (errors().dueLocal) setErrors({ ...errors(), dueLocal: undefined });
              }}
              validationState={errors().dueLocal ? "invalid" : "valid"}
            >
              <TextField.Label>截止时间</TextField.Label>
              <DateField type="datetime-local" value={dueLocal()}>
                <TextField.Input type="datetime-local" />
              </DateField>
              <TextField.ErrorMessage>{errors().dueLocal ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-muted-foreground">重复</span>
              <div class="flex items-center gap-2">
                <Select.Root
                  options={REPEAT_FREQ_OPTIONS}
                  optionValue={(option) => option.value}
                  optionTextValue={(option) => option.label}
                  itemToString={(option) => option.label}
                  value={selectedRepeatOption()}
                  onChange={(option) => setRepeatFreq(option?.value ?? "none")}
                >
                  <Select.Label class="sr-only">重复规则</Select.Label>
                  <Select.Trigger class="w-28">
                    <Select.Value>{selectedRepeatOption().label}</Select.Value>
                    <Select.Icon />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Listbox />
                  </Select.Content>
                </Select.Root>
                <Show when={repeatFreq() !== "none"}>
                  <span class="text-sm text-muted-foreground">每</span>
                  <TextField.Root
                    class="w-16"
                    value={repeatInterval()}
                    onChange={(value) => {
                      setRepeatInterval(value);
                      if (errors().repeatInterval) {
                        setErrors({ ...errors(), repeatInterval: undefined });
                      }
                    }}
                    validationState={errors().repeatInterval ? "invalid" : "valid"}
                  >
                    <TextField.Input type="number" min={1} aria-label="重复间隔" />
                    <TextField.ErrorMessage>
                      {errors().repeatInterval ?? ""}
                    </TextField.ErrorMessage>
                  </TextField.Root>
                  <span class="text-sm text-muted-foreground">{repeatUnit()}</span>
                </Show>
              </div>
              <Show when={repeatFreq() !== "none"}>
                <Checkbox.Root
                  checked={repeatPaused()}
                  onChange={(checked) => setRepeatPaused(checked)}
                  class="mt-0.5"
                >
                  <Checkbox.Input aria-label="暂停重复" />
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Checkbox.Label class="text-sm text-muted-foreground">
                    已暂停（完成后不生成下一次）
                  </Checkbox.Label>
                </Checkbox.Root>
              </Show>
            </div>

            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-muted-foreground">标签</span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
                  onClick={() => setManagerOpen(true)}
                >
                  <Settings2 size={13} aria-hidden="true" />
                  管理标签
                </button>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={tasksState.tags}>
                  {(tag) => (
                    <button
                      type="button"
                      aria-pressed={tagIds().includes(tag.id)}
                      class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-ring"
                      classList={{
                        "border-primary bg-primary/10 text-primary": tagIds().includes(
                          tag.id,
                        ),
                        "border-border bg-surface text-muted-foreground hover:bg-surface-hover":
                          !tagIds().includes(tag.id),
                      }}
                      onClick={() => toggleTag(tag.id)}
                    >
                      <Show when={tag.color}>
                        <span
                          class="size-2 rounded-full"
                          style={{ "background-color": tag.color ?? undefined }}
                        />
                      </Show>
                      {tag.name}
                    </button>
                  )}
                </For>
                <Show when={tasksState.tags.length === 0}>
                  <span class="text-xs text-muted-foreground">暂无标签</span>
                </Show>
              </div>
            </div>

            <div class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting()}>
                {props.task ? "保存" : "创建"}
              </Button>
            </div>
          </form>

          <TagManagerDialog open={managerOpen()} onOpenChange={setManagerOpen} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
