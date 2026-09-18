import { For, Show, createMemo, createSignal } from "solid-js";
import { ListTodo, MessageSquareText, Search, SearchX } from "lucide-solid";
import { Button, EmptyState, Skeleton, TextField } from "../../../common/components";
import { openTaskViewer } from "../../../common/stores/taskViewer";
import { useSearchData, useSearchResults } from "../hooks";
import { parseSnippet } from "../snippet";
import type { SearchHit } from "../types";

/** Title widths of the pending-search skeleton, cycled. Varying them stops the
 * stack reading as a table and makes the shimmer feel like real results. */
const SKELETON_WIDTHS = ["62%", "45%", "70%", "52%"];

function HitRow(props: { hit: SearchHit; onOpen: (hit: SearchHit) => void }) {
  const label = () =>
    props.hit.kind === "comment"
      ? `打开任务 ${props.hit.taskTitle}（评论命中）`
      : `打开任务 ${props.hit.taskTitle}`;

  return (
    <li>
      <button
        type="button"
        class="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-ring"
        aria-label={label()}
        onClick={() => props.onOpen(props.hit)}
      >
        <span class="mt-0.5 shrink-0 text-subtle-foreground" aria-hidden="true">
          {props.hit.kind === "comment" ? (
            <MessageSquareText size={16} />
          ) : (
            <ListTodo size={16} />
          )}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-foreground">
            {props.hit.taskTitle}
          </span>
          <span class="mt-0.5 block truncate text-xs text-muted-foreground">
            <Show when={props.hit.kind === "comment"}>评论：</Show>
            <For each={parseSnippet(props.hit.snippet)}>
              {(segment) =>
                segment.marked ? (
                  <mark class="rounded-sm bg-primary/15 px-0.5 font-medium text-primary">
                    {segment.text}
                  </mark>
                ) : (
                  segment.text
                )
              }
            </For>
          </span>
        </span>
      </button>
    </li>
  );
}

function HitSection(props: {
  label: string;
  hits: SearchHit[];
  onOpen: (hit: SearchHit) => void;
}) {
  return (
    <Show when={props.hits.length > 0}>
      <section aria-label={props.label}>
        <h2 class="pb-1 pt-3 text-2xs font-medium tracking-wide text-subtle-foreground">
          {props.label}（{props.hits.length}）
        </h2>
        <ul class="flex flex-col">
          <For each={props.hits}>{(hit) => <HitRow hit={hit} onOpen={props.onOpen} />}</For>
        </ul>
      </section>
    </Show>
  );
}

/**
 * The `/search` view (S-02): a debounced full-text search box over task
 * titles/notes/comments; clicking a hit focuses the task in the app-level
 * task viewer (`app/TaskViewer.tsx`).
 */
export function SearchView() {
  const [input, setInput] = createSignal("");
  const { hits, searching, failed } = useSearchResults(input);
  const { failed: loadFailed, retry } = useSearchData();

  const taskHits = createMemo(() => hits().filter((hit) => hit.kind === "task"));
  const commentHits = createMemo(() => hits().filter((hit) => hit.kind === "comment"));
  const hasQuery = () => input().trim().length > 0;

  /**
   * What the query produced, as one sentence. The hits themselves are buttons in
   * two headed sections, so a screen-reader user is told the counts nowhere else
   * — and results replacing a skeleton is exactly the update that goes unnoticed.
   */
  const outcome = () => {
    if (!hasQuery()) return "";
    if (searching()) return "搜索中…";
    if (failed()) return "搜索失败";
    if (hits().length === 0) return "没有匹配的结果";
    return `任务 ${taskHits().length} 条，评论 ${commentHits().length} 条`;
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      {/* One region, mounted for the view's whole life: a live region that
          arrives together with its text is announced unreliably. */}
      <div role="status" class="sr-only">
        {outcome()}
      </div>

      <div class="shrink-0 px-5 pb-3 pt-4">
        <TextField.Root class="relative">
          <Search
            size={16}
            aria-hidden="true"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground"
          />
          <TextField.Input
            aria-label="搜索任务"
            placeholder="搜索任务标题、备注、评论…"
            autofocus
            class="h-10 pl-9 text-base"
            value={input()}
            onInput={(event) => setInput(event.currentTarget.value)}
          />
        </TextField.Root>
      </div>

      <Show
        when={hasQuery()}
        fallback={
          <EmptyState
            icon={<Search size={22} />}
            title="全文搜索"
            description="输入关键词查找任务，范围覆盖标题、备注和评论；多个关键词需同时满足。"
          />
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <Show when={loadFailed()}>
            <div class="mb-2 flex items-center justify-between gap-3 rounded-lg bg-danger/12 px-3 py-2 text-danger">
              <span>任务数据加载失败，点开的结果可能无法显示详情。</span>
              <Button
                variant="destructive-ghost"
                size="sm"
                onClick={() => void retry()}
              >
                重试
              </Button>
            </div>
          </Show>

          <Show
            when={searching() && hits().length === 0}
            fallback={
              <Show
                when={!failed()}
                fallback={
                  <p role="alert" class="py-6 text-center text-sm text-muted-foreground">
                    搜索失败，请调整关键词后重试。
                  </p>
                }
              >
                <Show when={hits().length === 0}>
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title="没有匹配的结果"
                    description="换个关键词试试；少于三个字符的词也可以搜索。"
                  />
                </Show>
              </Show>
            }
          >
            {/* The pending state is announced by the status region above; the
                skeleton rows below carry no text of their own. */}
            <div class="pt-1">
              <div aria-hidden="true" class="flex flex-col">
                <For each={SKELETON_WIDTHS}>
                  {(width) => (
                    <div class="flex items-start gap-3 px-3 py-2.5">
                      <Skeleton class="mt-0.5 size-4 shrink-0 rounded-[5px]" />
                      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton class="h-3" style={{ width }} />
                        <Skeleton class="h-2.5 w-2/5" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <HitSection label="任务" hits={taskHits()} onOpen={(hit) => openTaskViewer(hit.taskId)} />
          <HitSection
            label="评论"
            hits={commentHits()}
            onOpen={(hit) => openTaskViewer(hit.taskId)}
          />
        </div>
      </Show>
    </div>
  );
}
