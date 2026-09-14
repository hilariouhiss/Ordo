import { For, Show, createSignal } from "solid-js";
import { Check, Pencil, Plus, Trash2, X } from "lucide-solid";
import { z } from "zod";
import { Button, Dialog, TextField } from "../../../common/components";
import { createTag, deleteTag, updateTag } from "../hooks";
import { tasksState } from "../store";
import type { Tag } from "../types";

/**
 * Tag management dialog (T-07): create/rename/recolor/delete tags. All
 * mutations run through the optimistic hooks, so new and changed tags show
 * up in the editor chips and the view filters immediately — including
 * deleting, which strips the tag from every task carrying it.
 */

/** Preset palette (PRD: tags carry an optional custom colour); `null` = no colour. */
export const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
] as const;

const nameSchema = z.string().trim().min(1, "标签名不能为空");

/** Extracts the message of a `nameSchema` failure (one field, one issue). */
function nameError(parsed: ReturnType<typeof nameSchema.safeParse>): string {
  if (parsed.success) return "";
  return parsed.error?.issues[0]?.message ?? "标签名无效";
}

/*
 * Shares ProjectEditorDialog's swatch recipe: 28px square chips instead of
 * 24px dots, so a colour is a target rather than a pixel hunt. The border comes
 * from the class rather than an inline style, so `hover:border-border-strong`
 * is what the pointer sees.
 */
const SWATCH_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-border transition focus-ring hover:border-border-strong active:scale-90";

function ColorSwatches(props: {
  value: () => string | null;
  onChange: (color: string | null) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={props.label} class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-label="无颜色"
        aria-pressed={props.value() === null}
        class={`${SWATCH_CLASS} bg-surface text-2xs text-muted-foreground`}
        classList={{ "ring-2 ring-ring": props.value() === null }}
        onClick={() => props.onChange(null)}
      >
        无
      </button>
      <For each={TAG_COLORS}>
        {(color) => (
          <button
            type="button"
            aria-label={`颜色 ${color}`}
            aria-pressed={props.value() === color}
            class={SWATCH_CLASS}
            classList={{ "ring-2 ring-ring": props.value() === color }}
            style={{ "background-color": color }}
            onClick={() => props.onChange(color)}
          >
            <Show when={props.value() === color}>
              <Check size={13} class="text-white mix-blend-difference" aria-hidden="true" />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

export interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TagManagerDialog(props: TagManagerDialogProps) {
  const [newName, setNewName] = createSignal("");
  const [newColor, setNewColor] = createSignal<string | null>(null);
  const [newError, setNewError] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  // Only one row is edited (or pending delete confirmation) at a time.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editColor, setEditColor] = createSignal<string | null>(null);
  const [editError, setEditError] = createSignal("");
  const [savingEdit, setSavingEdit] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  const usageCount = (tagId: string): number =>
    tasksState.tasks.filter((task) => task.tagIds.includes(tagId)).length;

  function startEdit(tag: Tag): void {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditError("");
    setDeletingId(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditError("");
  }

  async function handleCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const parsed = nameSchema.safeParse(newName());
    if (!parsed.success) {
      setNewError(nameError(parsed));
      return;
    }
    setNewError("");
    setCreating(true);
    try {
      // On failure the hook notifies + rolls back; keep the form for a retry.
      const created = await createTag({ name: parsed.data, color: newColor() });
      if (created) {
        setNewName("");
        setNewColor(null);
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleEditSave(tagId: string): Promise<void> {
    const parsed = nameSchema.safeParse(editName());
    if (!parsed.success) {
      setEditError(nameError(parsed));
      return;
    }
    setEditError("");
    setSavingEdit(true);
    try {
      const saved = await updateTag(tagId, { name: parsed.data, color: editColor() });
      if (saved) setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  }

  function startDelete(tagId: string): void {
    setDeletingId(tagId);
    setEditingId(null);
  }

  async function confirmDelete(tagId: string): Promise<void> {
    const removed = await deleteTag(tagId);
    if (removed) setDeletingId(null);
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-labelledby="tag-manager-title"
          class="max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title id="tag-manager-title">管理标签</Dialog.Title>
          <Dialog.Description>
            新建、重命名、换色或删除标签；删除会从所有任务上移除该标签。
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form class="mt-4 flex flex-col gap-2" onSubmit={handleCreate}>
            <TextField.Root
              value={newName()}
              onChange={(value) => {
                setNewName(value);
                if (newError()) setNewError("");
              }}
              validationState={newError() ? "invalid" : "valid"}
            >
              <TextField.Label>新建标签</TextField.Label>
              <div class="flex items-start gap-2">
                <TextField.Input placeholder="例如：工作" class="flex-1" />
                <Button type="submit" disabled={creating()}>
                  <Plus size={14} aria-hidden="true" />
                  添加
                </Button>
              </div>
              <TextField.ErrorMessage>{newError() ?? ""}</TextField.ErrorMessage>
            </TextField.Root>
            <ColorSwatches
              label="新建标签颜色"
              value={newColor}
              onChange={setNewColor}
            />
          </form>

          <ul class="mt-4 flex flex-col border-t border-border" aria-label="标签列表">
            <Show
              when={tasksState.tags.length > 0}
              fallback={
                <li class="py-6 text-center text-sm text-muted-foreground">
                  暂无标签，先在上方创建一个。
                </li>
              }
            >
              <For each={tasksState.tags}>
                {(tag) => (
                  <li class="border-b border-border py-2.5" data-tag-id={tag.id}>
                    <Show
                      when={editingId() === tag.id}
                      fallback={
                        <div class="flex items-center gap-2">
                          <span
                            class="size-3 shrink-0 rounded-full"
                            style={{
                              "background-color": tag.color ?? "var(--muted-foreground)",
                            }}
                            aria-hidden="true"
                          />
                          <span class="min-w-0 flex-1 truncate text-sm text-foreground">
                            {tag.name}
                          </span>
                          <span class="shrink-0 text-xs text-subtle-foreground">
                            {usageCount(tag.id)} 个任务
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`编辑标签 ${tag.name}`}
                            onClick={() => startEdit(tag)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="destructive-ghost"
                            size="sm"
                            aria-label={`删除标签 ${tag.name}`}
                            onClick={() => startDelete(tag.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      }
                    >
                      <div class="flex flex-col gap-2">
                        <TextField.Root
                          value={editName()}
                          onChange={(value) => {
                            setEditName(value);
                            if (editError()) setEditError("");
                          }}
                          validationState={editError() ? "invalid" : "valid"}
                        >
                          <TextField.Label class="sr-only">
                            编辑标签 {tag.name}
                          </TextField.Label>
                          <TextField.Input />
                          <TextField.ErrorMessage>{editError() ?? ""}</TextField.ErrorMessage>
                        </TextField.Root>
                        <ColorSwatches
                          label={`编辑标签 ${tag.name} 颜色`}
                          value={editColor}
                          onChange={setEditColor}
                        />
                        <div class="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={cancelEdit}>
                            <X size={14} aria-hidden="true" />
                            取消
                          </Button>
                          <Button
                            size="sm"
                            disabled={savingEdit()}
                            onClick={() => void handleEditSave(tag.id)}
                          >
                            <Check size={14} aria-hidden="true" />
                            保存
                          </Button>
                        </div>
                      </div>
                    </Show>
                    <Show when={deletingId() === tag.id}>
                      <div class="mt-2 flex items-center justify-between gap-2 rounded-lg bg-danger/10 px-3 py-2">
                        <span class="text-xs text-danger">
                          将同时从 {usageCount(tag.id)} 个任务上移除，确认删除？
                        </span>
                        <div class="flex shrink-0 gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDeletingId(null)}
                          >
                            取消
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => void confirmDelete(tag.id)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
