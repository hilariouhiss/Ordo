import { For, Show, createMemo, createSignal } from "solid-js";
import { X } from "lucide-solid";
import { iconButtonClass } from "../../../common/components";
import { addDependency, removeDependency } from "../hooks";
import { buildIndex, completionSet, liveSet, successorsOf, wouldCycle } from "../dependencies";
import { childrenOf, getTask, tasksState, topLevelTasks } from "../store";

export interface TaskDependenciesProps {
  taskId: string;
}

/**
 * 任务详情的依赖区：前置可增可删，后置只读。
 *
 * 候选列表在前端先滤掉自身、已添加的和必然成环的任务 —— 后端仍然会拒绝成环
 * （它是权威），但让用户点到一个必然报错的选项是纯粹的浪费。
 */
export function TaskDependencies(props: TaskDependenciesProps) {
  const [query, setQuery] = createSignal("");

  const index = createMemo(() =>
    buildIndex(tasksState.dependencies, liveSet(tasksState.tasks)),
  );
  const done = createMemo(() => completionSet(tasksState.tasks));

  const titleOf = (id: string) => getTask(id)?.title ?? "（已删除）";
  const prerequisites = createMemo(
    () => index().prerequisites.get(props.taskId) ?? [],
  );
  const successors = createMemo(() => successorsOf(index(), props.taskId));

  const candidates = createMemo(() => {
    const term = query().trim().toLowerCase();
    if (!term) return [];
    const taken = new Set(prerequisites());
    // §7.4: the pool is the task's own siblings when it has a parent, and the
    // top-level tasks otherwise. A child's prerequisite is the step beside it,
    // so a child is never offered a top-level task — and, since the siblings
    // come from the store, the parent is not in its own child's pool either.
    const parentId = getTask(props.taskId)?.parentTaskId ?? null;
    return (parentId === null ? topLevelTasks() : childrenOf(parentId))
      .filter((task) => task.id !== props.taskId && !taken.has(task.id))
      .filter((task) => task.title.toLowerCase().includes(term))
      .filter((task) => !wouldCycle(index(), props.taskId, task.id))
      .slice(0, 6);
  });

  return (
    <section aria-label="依赖">
      <h3 class="text-sm font-medium text-foreground">依赖</h3>

      <p class="mt-1.5 text-xs text-muted-foreground">
        前置完成后这项才算解锁；被阻塞时完成需要一次确认。
      </p>

      <ul class="mt-2 flex flex-col gap-1.5">
        <For each={prerequisites()} fallback={<li class="text-xs text-subtle-foreground">暂无前置</li>}>
          {(id) => (
            <li class="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
              <span
                class="min-w-0 flex-1 truncate"
                classList={{ "text-subtle-foreground line-through": done().has(id) }}
              >
                {titleOf(id)}
              </span>
              <button
                type="button"
                class={iconButtonClass}
                aria-label={`移除前置 ${titleOf(id)}`}
                onClick={() => void removeDependency(props.taskId, id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          )}
        </For>
      </ul>

      <div class="mt-2.5 flex flex-col gap-1.5">
        <input
          type="text"
          aria-label="添加前置"
          placeholder="输入任务标题以添加前置"
          class="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong focus-ring"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <For each={candidates()}>
          {(candidate) => (
            <button
              type="button"
              class="truncate rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
              aria-label={`添加前置 ${candidate.title}`}
              onClick={() => {
                void addDependency(props.taskId, candidate.id);
                setQuery("");
              }}
            >
              {candidate.title}
            </button>
          )}
        </For>
      </div>

      <Show when={successors().length > 0}>
        <p class="mt-3 text-xs text-muted-foreground">
          后置（等待本任务）：
          <For each={successors()}>
            {(id, position) => (
              <span>
                {position() > 0 ? "、" : ""}
                {titleOf(id)}
              </span>
            )}
          </For>
        </p>
      </Show>
    </section>
  );
}
