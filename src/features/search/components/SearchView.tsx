import { For, Show, createMemo, createSignal } from "solid-js";
import { ListTodo, MessageSquareText, Search } from "lucide-solid";
import { Button, TextField } from "../../../common/components";
import { openTaskViewer } from "../../../common/stores/taskViewer";
import { useSearchData, useSearchResults } from "../hooks";
import { parseSnippet } from "../snippet";
import type { SearchHit } from "../types";

function HitRow(props: { hit: SearchHit; onOpen: (hit: SearchHit) => void }) {
  const label = () =>
    props.hit.kind === "comment"
      ? `打开任务 ${props.hit.taskTitle}（评论命中）`
      : `打开任务 ${props.hit.taskTitle}`;

  return (
    <li>
      <button
        type="button"
        class="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
        <h2 class="pb-1 pt-2 text-xs font-medium text-subtle-foreground">
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

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-b border-border px-6 py-3">
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
            class="pl-9"
            value={input()}
            onInput={(event) => setInput(event.currentTarget.value)}
          />
        </TextField.Root>
      </div>

      <Show
        when={hasQuery()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <Search size={28} class="text-subtle-foreground" aria-hidden="true" />
            <h2 class="text-base font-semibold text-foreground">全文搜索</h2>
            <p class="max-w-sm text-sm text-muted-foreground">
              输入关键词查找任务，范围覆盖标题、备注和评论；多个关键词需同时满足。
            </p>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          <Show when={loadFailed()}>
            <div class="mb-2 flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
              <span>任务数据加载失败，点开的结果可能无法显示详情。</span>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-xs text-danger hover:bg-danger/10"
                onClick={() => void retry()}
              >
                重试
              </Button>
            </div>
          </Show>

          <Show
            when={searching() && hits().length === 0}
            fallback={
              <Show when={!failed()} fallback={
                <p role="alert" class="py-6 text-center text-sm text-muted-foreground">
                  搜索失败，请调整关键词后重试。
                </p>
              }>
                <Show when={hits().length === 0}>
                  <div class="flex flex-col items-center gap-1 py-10 text-center">
                    <h2 class="text-base font-semibold text-foreground">没有匹配的结果</h2>
                    <p class="text-sm text-muted-foreground">
                      换个关键词试试；少于三个字符的词也可以搜索。
                    </p>
                  </div>
                </Show>
              </Show>
            }
          >
            <p role="status" class="py-1 text-xs text-subtle-foreground">
              搜索中…
            </p>
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
