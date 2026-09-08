import { For, Show, createEffect, createSignal, on } from "solid-js";
import { z } from "zod";
import { Button, Dialog, Select, TextField } from "../../../common/components";
import {
  isoToLocalInputValue,
  localInputValueToIso,
} from "../../../common/utils/datetime";
import { createTask, updateTask } from "../hooks";
import { tasksState } from "../store";
import type { Priority, Task } from "../types";

/**
 * Create/edit task dialog (T-04). One component covers both modes: pass
 * `task` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the
 * form open and surface a notification (handled by the hooks).
 */

const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "none", label: "无" },
];

const formSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空"),
  dueLocal: z
    .string()
    .refine(
      (value) => value === "" || !Number.isNaN(new Date(value).getTime()),
      "截止时间无效",
    ),
});

type FormField = "title" | "dueLocal";

export interface TaskEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task to edit; omit to create a new one. */
  task?: Task;
}

export function TaskEditorDialog(props: TaskEditorDialogProps) {
  const [title, setTitle] = createSignal("");
  const [note, setNote] = createSignal("");
  const [priority, setPriority] = createSignal<Priority>("none");
  const [dueLocal, setDueLocal] = createSignal("");
  const [tagIds, setTagIds] = createSignal<string[]>([]);
  const [errors, setErrors] = createSignal<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = createSignal(false);

  // Re-seed the form whenever the dialog (re)opens or switches task.
  createEffect(
    on(
      () => [props.open, props.task] as const,
      ([open, task]) => {
        if (!open) return;
        setTitle(task?.title ?? "");
        setNote(task?.note ?? "");
        setPriority(task?.priority ?? "none");
        setDueLocal(isoToLocalInputValue(task?.dueAt ?? null));
        setTagIds(task ? [...task.tagIds] : []);
        setErrors({});
        setSubmitting(false);
      },
    ),
  );

  const selectedPriority = () =>
    PRIORITY_OPTIONS.find((option) => option.value === priority()) ??
    PRIORITY_OPTIONS[PRIORITY_OPTIONS.length - 1];

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

    setErrors({});
    setSubmitting(true);
    try {
      const noteValue = note().trim() ? note().trim() : null;
      const payload = {
        title: parsed.data.title,
        note: noteValue,
        priority: priority(),
        dueAt: localInputValueToIso(parsed.data.dueLocal),
        tagIds: [...tagIds()],
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
        <Dialog.Content aria-labelledby="task-editor-title">
          <Dialog.Title id="task-editor-title">
            {props.task ? "编辑任务" : "新建任务"}
          </Dialog.Title>
          <Dialog.Description>
            {props.task ? "修改任务内容后保存" : "填写任务内容，标题必填"}
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form class="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <TextField.Root
              value={title()}
              onChange={(value) => {
                setTitle(value);
                if (errors().title) setErrors({ ...errors(), title: undefined });
              }}
              validationState={errors().title ? "invalid" : "valid"}
            >
              <TextField.Label>标题</TextField.Label>
              <TextField.Input placeholder="例如：写周报" />
              <TextField.ErrorMessage>{errors().title ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <TextField.Root value={note()} onChange={setNote}>
              <TextField.Label>备注</TextField.Label>
              <TextField.TextArea placeholder="补充说明（可选）" />
            </TextField.Root>

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

            <TextField.Root
              value={dueLocal()}
              onChange={(value) => {
                setDueLocal(value);
                if (errors().dueLocal) setErrors({ ...errors(), dueLocal: undefined });
              }}
              validationState={errors().dueLocal ? "invalid" : "valid"}
            >
              <TextField.Label>截止时间</TextField.Label>
              <TextField.Input type="datetime-local" />
              <TextField.ErrorMessage>{errors().dueLocal ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <div class="flex flex-col gap-1.5">
              <span class="text-sm font-medium text-foreground">标签</span>
              <div class="flex flex-wrap gap-2">
                <For each={tasksState.tags}>
                  {(tag) => (
                    <button
                      type="button"
                      aria-pressed={tagIds().includes(tag.id)}
                      class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
