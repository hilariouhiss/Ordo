# 任务列表的层级展示（设计）

日期：2026-09-14
状态：已确认，待实施

## 1. 背景与目标

项目详情页的任务列表目前只渲染顶级任务。子任务只能通过点开单个任务的详情弹窗看到，也就是说「一个任务还剩几项子任务没做」这件事在列表层面完全不可见。

目标：让列表像文件树一样按层级展示子任务，展开/收起，并在折叠状态下直接显示子任务的完成进度。

PRD 59–60 行已经允许子任务存在（「任务可包含多级子任务（至少支持一级，v1 可限制为一级）」「父任务可展示子任务完成进度」），但没有规定列表要按层级展示。本次是**新增一条展示层需求**，需要同步 PRD。

## 2. 非目标

- 看板卡片上的层级展示（看板是另一套布局：定宽列 + 拖拽卡片）
- 子任务的就地新增 / 改名 / 删除 / 拖动排序
- 多级嵌套（子任务的子任务）。`subtasks` 表没有 `parent_subtask_id`，本次层级固定两层
- 项目头部 `ProjectProgress` 的统计口径变更

## 3. 现状：影响设计的事实

| 事实 | 出处 | 影响 |
| --- | --- | --- |
| `subtasks` 表无 `parent_subtask_id` | `V2__schema.sql` | 层级固定两层，无需递归 |
| 子任务只能按 `task_id` 单个查询 | `subtask:list` | 要提前知道「谁有子任务」必须新增批量查询 |
| `task:list` 不返回任何子任务数据 | `repositories::tasks::list` | 同上 |
| 子任务懒加载进 `subtasksByTask`，`hasSubtasks` 判断缓存是否命中 | `store.ts` | 保留懒加载作为兜底 |
| `VirtualList` 是**固定行高**，不支持测量 | `virtual-list.tsx` | 树必须拍平成等高行，否则要重写这个共用原语 |
| `soft_delete_task` **不**级联软删除子任务 | `services.rs:414` | `list_all` 必须 JOIN 父任务，否则每次启动都会带回已删除任务的子任务 |
| `setAll(tasks, tags)` 整体替换，不重置 `subtasksByTask` | `store.ts:83` | 批量写入子任务缓存需要自己的 setter |
| `loadAll` 用 `Promise.all([listTasks, listTags])` | `hooks.ts:72` | 批量查询并入这里 |

## 4. 数据层

### 4.1 后端

新增一个与 `task:list` 对称的全量查询，放在现有 subtask 链路里，不新建模块：

- `repositories::subtasks::list_all(conn)` —— 复用 `SUBTASK_COLUMNS` 与 `subtask_from_row`：

  ```sql
  SELECT {SUBTASK_COLUMNS} FROM subtasks
   WHERE deleted_at IS NULL
     AND task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL)
   ORDER BY task_id, sort_order, created_at, id
  ```

  用子查询而不是 `JOIN tasks t`：`SUBTASK_COLUMNS` 里的 `id` / `deleted_at` 都不带表前缀，一旦 JOIN 就会和 `tasks` 的同名列撞成 ambiguous column，那样就得为这一条查询再维护一份带前缀的列清单。子查询既避开了歧义，也让这份列常量只有一处定义；`tasks.id` 是主键，`IN` 子查询走索引。

  这个存活判断是必需的：任务被软删除时它的子任务仍是 `deleted_at IS NULL`（`services::soft_delete_task` 不级联），不加这个条件，被删任务的子任务会永远留在每次 `loadAll` 的返回里，随使用时间无界增长。

- `services::list_all_subtasks(conn)` —— 与 `list_subtasks` 同形的透传
- `commands::subtask_list_all`，`#[tauri::command(rename = "subtask:listAll")]`，在 `lib.rs` 的 `invoke_handler` 注册
- 前端 `COMMANDS.subtask.listAll = "subtask:listAll"`，`api.listSubtasksAll()`

`subtask:list` 保持不变，仍然按任务查询。

### 4.2 前端 store

新增 `setSubtasksAll(subtasks: Subtask[])`：

- 按 `taskId` 分组，然后以**当前 `state.tasks` 为准重建整张表**
- 为每个存活任务建好条目，没有子任务的任务得到 `[]`

为什么必须给空任务也建条目：`hasSubtasks(taskId)` 的实现是 `taskId in state.subtasksByTask`，详情弹窗靠它决定要不要再拉一次。批量加载之后若某一堆任务没有键，打开它们的详情就会各自白发一次 `subtask:list` —— 数据明明已经在手里了。

重建而不是合并，顺带清掉了已删除任务的陈旧键。

### 4.3 加载

```ts
const [tasks, tags, subtasks] = await Promise.all([
  api.listTasks(), api.listTags(), api.listSubtasksAll(),
]);
store.setAll(tasks, tags);
store.setSubtasksAll(subtasks);
```

子任务查询失败即整体 `loadAll` 失败，与现有语义一致（单库单连接，查询失败就是数据库故障）。

**保留懒加载兜底。** `loadSubtasks` 与 `hasSubtasks` 不动，因为它们仍覆盖一个真实场景：会话中途新建、且带初始子任务的任务，缓存里还没有它的条目。

`createTask` 需要在成功分支补一次拉取：当 `input.subtaskTitles` 非空时，`store.upsertTask(created)` 之后 `void loadSubtasks(created.id)`。不补的话，列表里新建的任务不会显示进度徽章，直到用户点开它的详情——这与「列表能看出子任务进度」的目标直接矛盾。用 fire-and-forget，任务本身仍然瞬时出现。

## 5. 树形渲染

### 5.1 拍平成等高行

`VirtualList` 完全不动。树拍平后仍是等高的 56px 行序列，`itemHeight` 不变，1 万条任务的虚拟滚动测试继续成立。

```ts
type Row =
  | { kind: "task"; task: Task }
  | { kind: "subtask"; task: Task; subtask: Subtask };   // task = 父任务

const rows = createMemo(() =>
  visible().flatMap((task) => {
    const kids = getSubtasks(task.id);
    if (kids.length === 0 || !expanded()[task.id]) return [{ kind: "task", task }];
    return [{ kind: "task", task }, ...kids.map((subtask) => ({ kind: "subtask", task, subtask }))];
  }),
);
```

- 展开状态是组件内的 `createSignal<Record<string, boolean>>`，不发 IPC —— 数据已在缓存，展开是瞬时的
- 行的 key：任务用 `task.id`，子任务用 `subtask.id`
- 子任务的顺序恒为 `sortOrder`（即 `getSubtasks` 返回的顺序），不参与外层排序

### 5.2 筛选与排序只作用于顶级任务

子任务没有优先级、标签、截止日期，对它们做筛选没有意义。更重要的是：一旦筛选把某个父任务的子任务藏掉，行上的「2/5」就在说谎——显示 5 项却只列得出 3 行。

因此 `applyFilter` / `sortTasks` 的应用范围不变（仍作用于 `props.tasks()`），展开后子任务整份列出。

## 6. 行的视觉与交互

### 6.1 对齐方案

父任务行左侧新增一个 20px 展开位，子任务行在**同一位置留等宽空白**。于是两级的复选框严格对齐成一列，缩进靠这个 gutter 加一条 1px 竖向导引线表达。这是 VS Code / Finder 的树形对齐方式，不需要计算缩进值，也不会因为标题层级变化而错位。

```
▸ ☐ 写季度总结                   2/5   高   #工作   10月3日
▾ ☐ 设计评审                     2/5
  │ ☑ 收集意见
  │ ☐ 定稿
  │ ☐ 排期
▸ ☐ 整理会议纪要
```

- 有子任务才画三角；无子任务的行渲染等宽占位块，保证整列对齐
- 行高沿用 56px（见 §9）

### 6.2 `TaskItemRow` 新增的 props

`subtaskCount: number`、`subtaskDone: number`、`expanded: boolean`、`onToggleExpand: (task: Task) => void`。

- `subtaskCount > 0` 时渲染三角按钮：`ChevronRight`，展开时 `rotate-90`，`aria-expanded`，`aria-label={`${展开|收起} ${task.title} 的子任务`}`，复用 `focus-ring`
- 进度徽章用现有 `<Badge variant="default">{done}/{count}</Badge>`，放在行尾徽章簇的**最前**（在优先级之前）
- 徽章与三角只在 `subtaskCount > 0` 时出现

### 6.3 新增 `SubtaskRow`

单独成组件，因为它是 `TaskItemRow` 的真子集：无优先级、无标签、无截止日期、无重复标记、无右键菜单、无拖拽。

- 结构：`[20px 占位][竖向导引线][复选框][标题]`
- 复选框 → `completeSubtask(parentTask.id, subtask.id, done)`，走现有乐观更新
- 标题按钮 → 打开**父任务**的详情弹窗（子任务没有独立详情；弹窗里能看到它）
- 标题用 `text-sm text-muted-foreground`，完成态加 `line-through`，与父任务行同级但更轻

### 6.4 交互语义

| 操作 | 结果 |
| --- | --- |
| 点三角 | 展开 / 收起，纯本地状态 |
| 点子任务复选框 | `completeSubtask`，父行的 `2/5` 同帧更新 |
| 点子任务标题 | 打开父任务详情 |
| 点父任务复选框 | 完成的仍是父任务本身，**不级联**（保持现有语义） |

## 7. 边界情况

- **筛选后父任务被排除**：其子任务一并消失（它们只在父行展开时存在）
- **勾选子任务使其完成**：父任务本身没完成，所以父任务仍留在当前视图，子行显示为已完成（带删除线）。父行的数字跟着走
- **任务在展开状态下被删除**：`expanded` 里会残留一个不再被读取的键。无副作用，不做清理
- **子任务全部完成但父任务未完成**：父行显示 `3/3`，父任务本身仍在待办状态。不自动完成父任务
- **快速新增窗口创建的任务**：走 `task:created` 事件触发 `loadAll`，批量查询会覆盖到

## 8. 测试

Rust：

- `list_all` 跨任务返回全部子任务，按 `task_id, sort_order` 有序
- 排除软删除的子任务
- **排除父任务已软删除的子任务**（对应 §4.1 的 JOIN）

前端（新增用例，放在任务视图测试里）：

- 默认折叠：有子任务的任务行显示三角与 `0/N`，子任务标题不可见
- 展开：子行按 `sortOrder` 出现在父行之后
- 再收起：子行消失
- 勾选子任务：调用 `subtask:complete`，父行进度变为 `1/N`
- 点击子任务标题：打开的是父任务的详情
- 无子任务的任务行没有三角
- 筛选激活时，展开的任务仍列出全部子任务

现有 373 条测试全部保持通过。`task-detail-dialog` 里「没有缓存时走 `subtask:list`」一条前提仍成立（§4.3 保留懒加载兜底）。

## 9. 取舍与已知代价

**子任务行沿用 56px 行高，不改 `VirtualList`。** 代价是只有复选框和一行标题的子任务行显得偏空。

替代方案是给虚拟列表加变高支持（行偏移量前缀和 + 测量 + 滚动锚定），但那是重写一个被 5 个视图共用的原语，超出本功能的合理范围。若落地后观感确实太散，变高虚拟化单独开一次改动。

## 10. 文档同步

- `docs/PRD.md`：3.1 附近补一条列表层级展示需求；说明筛选只作用于顶级任务
- `docs/ARCHITECTURE.md`：2.x 数据流补「子任务随 `loadAll` 全量载入，按任务懒加载作为兜底」；组件清单补 `SubtaskRow`
- `docs/IMPLEMENTATION_PLAN.md`：在任务功能里程碑下新增一行，记录层级展示与 `subtask:listAll`

## 11. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/repositories.rs` | `subtasks::list_all` |
| `src-tauri/src/services.rs` | `list_all_subtasks` |
| `src-tauri/src/commands.rs` | `subtask_list_all` |
| `src-tauri/src/lib.rs` | 注册新命令 |
| `src/common/ipc/commands.ts` | `subtask.listAll` |
| `src/features/tasks/api.ts` | `listSubtasksAll` |
| `src/features/tasks/store.ts` | `setSubtasksAll` |
| `src/features/tasks/hooks.ts` | `loadAll` 并入批量查询；`createTask` 带初始子任务时补拉 |
| `src/features/tasks/components/TaskListView.tsx` | 拍平成行序列、展开状态、行类型分发 |
| `src/features/tasks/components/TaskItemRow.tsx` | 三角、占位、进度徽章 |
| `src/features/tasks/components/SubtaskRow.tsx` | 新增 |
