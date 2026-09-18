import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Pencil, Trash2 } from "lucide-solid";
import { iconButtonClass } from "../../../common/components";
import { format } from "date-fns";
import { createComment, deleteComment, updateComment } from "../hooks";
import { getComments } from "../store";
import type { Comment } from "../types";

export interface CommentListProps {
  taskId: string;
}

/**
 * One task's comment list (C-01): add via the input, inline-edit by clicking
 * the body, delete. Comments are chronological and every write goes through
 * the optimistic hooks, so edits and deletes reflect instantly.
 */
export function CommentList(props: CommentListProps) {
  const comments = createMemo(() => getComments(props.taskId));

  const [newBody, setNewBody] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");
  let editorRef: HTMLTextAreaElement | undefined;

  /*
   * Opening an inline editor unmounts the button that had focus, so focus would
   * otherwise fall to `<body>` and a keyboard user would restart from the top of
   * the dialog. Focus is taken here rather than from the field's own `ref`: the
   * ref runs while Solid is still building the subtree it re-renders again, and
   * focusing an element that is about to be replaced fires its `blur` — which is
   * this component's commit handler.
   */
  createEffect(() => {
    if (editingId() === null) return;
    editorRef?.focus();
  });

  function startEdit(comment: Comment): void {
    setEditingId(comment.id);
    setEditValue(comment.body);
  }

  /** Commits the inline edit; empty input cancels, unchanged skips the IPC. */
  function commitEdit(commentId: string): void {
    if (editingId() !== commentId) return;
    const body = editValue().trim();
    setEditingId(null);
    if (!body) return;
    const current = getComments(props.taskId).find((item) => item.id === commentId);
    if (current && body !== current.body) {
      void updateComment(props.taskId, commentId, { body });
    }
  }

  function add(): void {
    const body = newBody().trim();
    if (!body) return;
    setNewBody("");
    void createComment(props.taskId, { body });
  }

  return (
    <section aria-label="评论">
      <h3 class="text-sm font-medium text-foreground">评论</h3>

      <ul class="mt-2 flex flex-col">
        <For each={comments()}>
          {(comment) => (
            <li class="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover">
              <Show
                when={editingId() === comment.id}
                fallback={
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left text-sm focus-ring"
                    onClick={() => startEdit(comment)}
                  >
                    <span class="block whitespace-pre-wrap break-words">{comment.body}</span>
                    <span
                      class="mt-0.5 block text-xs text-subtle-foreground"
                      title={new Date(comment.createdAt).toLocaleString()}
                    >
                      {format(new Date(comment.createdAt), "MM-dd HH:mm")}
                      <Show when={comment.updatedAt !== comment.createdAt}>（已编辑）</Show>
                    </span>
                  </button>
                }
              >
                <textarea
                  aria-label="编辑评论"
                  class="min-w-0 flex-1 resize-y rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus-ring"
                  rows={2}
                  ref={(el) => {
                    editorRef = el;
                  }}
                  value={editValue()}
                  onInput={(event) => setEditValue(event.currentTarget.value)}
                  onBlur={() => commitEdit(comment.id)}
                  onKeyDown={(event) => {
                    // Enter during IME composition belongs to the IME, not to us.
                    if (event.key === "Enter" && !event.isComposing && !event.shiftKey) {
                      commitEdit(comment.id);
                    }
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              </Show>

              <Show when={editingId() !== comment.id}>
                <div class="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    class={iconButtonClass}
                    aria-label={`编辑评论 ${comment.body}`}
                    onClick={() => startEdit(comment)}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class={iconButtonClass}
                    aria-label={`删除评论 ${comment.body}`}
                    onClick={() => void deleteComment(props.taskId, comment.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </Show>
            </li>
          )}
        </For>
        <Show when={comments().length === 0}>
          <li class="px-2 py-1.5 text-sm text-subtle-foreground">还没有评论</li>
        </Show>
      </ul>

      <input
        type="text"
        aria-label="添加评论"
        placeholder="添加评论，回车确认"
        class="mt-2 h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong focus-ring"
        value={newBody()}
        onInput={(event) => setNewBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter during IME composition belongs to the IME, not to us.
          if (event.key === "Enter" && !event.isComposing) add();
        }}
      />
    </section>
  );
}
