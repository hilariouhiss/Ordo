import { For, Show, createMemo, createSignal } from "solid-js";
import { Button, DateField, Select, TextField } from "../../../common/components";
import { COMPLEXITY_OPTIONS, complexityFromOption, complexityOptionValue } from "../complexity";
import { isoToLocalInputValue, localInputValueToIso } from "../../../common/utils/datetime";
import { buildIndex, entityKey, liveSet, wouldCycle } from "../dependencies";
import { addDependency, removeDependency, updateSubtask } from "../hooks";
import { PRIORITY_OPTIONS } from "../priority";
import { getSubtasks, tasksState } from "../store";
import type { Subtask } from "../types";

export interface SubtaskEditorProps {
  taskId: string;
  subtask: Subtask;
  onClose: () => void;
}

/**
 * 一个子任务的属性面板，就地展开在它的行下方：描述、优先级、截止时间、复杂度
 * 与前置子任务。
 *
 * 四个字段一次写回（`updateSubtask` 一次 IPC），而不是每敲一键发一次；依赖的
 * 勾选是离散动作，各自立即落库。
 */
export function SubtaskEditor(props: SubtaskEditorProps) {
  const [note, setNote] = createSignal(props.subtask.note ?? "");
  const [priority, setPriority] = createSignal(props.subtask.priority);
  const [dueLocal, setDueLocal] = createSignal(isoToLocalInputValue(props.subtask.dueAt));
  const [complexity, setComplexity] = createSignal<number | null>(props.subtask.complexity);
  const [saving, setSaving] = createSignal(false);

  const siblings = createMemo(() =>
    getSubtasks(props.taskId).filter((item) => item.id !== props.subtask.id),
  );
  const index = createMemo(() =>
    buildIndex(tasksState.dependencies, liveSet(tasksState.tasks, tasksState.subtasksByTask)),
  );
  const prerequisites = createMemo(
    () => index().prerequisites.get(entityKey("subtask", props.subtask.id)) ?? [],
  );

  const selectedPriority = () =>
    PRIORITY_OPTIONS.find((option) => option.value === priority()) ??
    PRIORITY_OPTIONS[PRIORITY_OPTIONS.length - 1];
  const selectedComplexity = () =>
    COMPLEXITY_OPTIONS.find((option) => option.value === complexityOptionValue(complexity())) ??
    COMPLEXITY_OPTIONS[0];

  async function save(): Promise<void> {
    if (saving()) return;
    setSaving(true);
    const saved = await updateSubtask(props.taskId, props.subtask.id, {
      note: note().trim() ? note().trim() : null,
      priority: priority(),
      dueAt: localInputValueToIso(dueLocal()),
      complexity: complexity(),
    });
    setSaving(false);
    if (saved) props.onClose();
  }

  return (
    <div class="mb-1.5 flex flex-col gap-3 rounded-md border border-border bg-surface px-2.5 py-2.5">
      <TextField.Root value={note()} onChange={setNote}>
        <TextField.Label>描述</TextField.Label>
        <TextField.TextArea placeholder="补充说明（可选）" />
      </TextField.Root>

      <div class="flex flex-wrap gap-2">
        <Select.Root
          options={PRIORITY_OPTIONS}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedPriority()}
          onChange={(option) => setPriority(option?.value ?? "none")}
        >
          <Select.Label class="sr-only">子任务优先级</Select.Label>
          <Select.Trigger class="w-24">
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
          <Select.Label class="sr-only">子任务复杂度</Select.Label>
          <Select.Trigger class="w-32">
            <Select.Value>{selectedComplexity().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <TextField.Root class="w-52" value={dueLocal()} onChange={setDueLocal}>
          <TextField.Label class="sr-only">子任务截止时间</TextField.Label>
          <DateField type="datetime-local" value={dueLocal()}>
            <TextField.Input type="datetime-local" aria-label="子任务截止时间" />
          </DateField>
        </TextField.Root>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">前置子任务</span>
        <div class="flex flex-wrap gap-1.5">
          <For each={siblings()}>
            {(sibling) => {
              const selected = () => prerequisites().includes(sibling.id);
              return (
                <button
                  type="button"
                  aria-pressed={selected()}
                  disabled={!selected() && wouldCycle(index(), "subtask", props.subtask.id, sibling.id)}
                  class="rounded-md border px-2 py-1 text-xs transition-colors focus-ring disabled:opacity-40"
                  classList={{
                    "border-primary bg-primary/10 text-primary": selected(),
                    "border-border bg-surface text-muted-foreground hover:bg-surface-hover":
                      !selected(),
                  }}
                  onClick={() =>
                    void (selected()
                      ? removeDependency("subtask", props.subtask.id, sibling.id)
                      : addDependency("subtask", props.subtask.id, sibling.id))
                  }
                >
                  {sibling.title}
                </button>
              );
            }}
          </For>
          <Show when={siblings().length === 0}>
            <span class="text-xs text-subtle-foreground">这是唯一的子任务</span>
          </Show>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={props.onClose}>
          取消
        </Button>
        <Button size="sm" disabled={saving()} onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );
}
