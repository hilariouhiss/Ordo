# Ordo 变更需求记录（v1 迭代，2026-09-15）

**状态**：待评审 → 评审通过后按 §4 顺序逐条实现（每条一个提交）
**范围**：R1–R7，均为 M0–M9 已交付功能之上的增量变更，不新增子系统
**文档同步义务**（AGENTS.md）：每条落地时同提交更新 `docs/PRD.md`（行为/范围变化）与
`docs/IMPLEMENTATION_PLAN.md`（任务拆分）；涉及数据模型或模块边界的（R2、R7c）同时更新
`docs/ARCHITECTURE.md`。

## 1. 总览与复杂度排序（易 → 难）

| 序 | 编号 | 需求 | 复杂度 | 后端/迁移 | 主要落点 |
|----|------|------|--------|-----------|----------|
| 1 | R4 | 新建命名空间入口改成与项目一致的「标题 ＋」 | 很小 | 无 | `src/app/AppShell.tsx` |
| 2 | R3 | 新建时未指定颜色 → 随机颜色（命名空间/项目/标签） | 很小 | 无 | `src/common/colors.ts`、`features/*/hooks.ts` |
| 3 | R1 | 子元素缩进规则统一（由子任务扩展到所有内联子列表） | 小 | 无 | `src/index.css`、`AppShell.tsx`、`SubtaskRow.tsx` |
| 4 | R5 | 新建项目时可顺手新建命名空间 | 小–中 | 无（两次现有写操作） | `ProjectEditorDialog.tsx` |
| 5 | R2 | 项目不设截止日期 | 中 | 有（V6 迁移，可选） | 前端 7 文件 + Rust 4 文件 + PRD |
| 6 | R6 | 日期控件空值文案统一为「年/月/日 时:分」 | 小–中 | 无 | 新共享控件 + 5 个调用点 |
| 7 | R7a | 拖拽：项目 → 命名空间 | 中 | 无（`project:update`） | `AppShell.tsx` + 拖拽状态 |
| 8 | R7b | 拖拽：任务 → 项目 | 中–大 | 无（`task:update`） | 任务行 + 侧边栏落点 |
| 9 | R7c | 拖拽：任务 → 任务（变成其子任务） | 大 | 有（`parent_task_id`，见 §7） | 任务列表 + 数据模型 |

**顺序说明**

- R5、R2、R6 都要改 `ProjectEditorDialog.tsx`：按 R5 → R2 → R6 落地，文件碰撞最少（R2 先删掉该弹窗里的日期字段，R6 就少一个调用点）。
- R3 落在创建收口（`createProject` / `createNamespace`），R5 的内联建命名空间自动继承，无需重复处理。
- R1 与 R7 无耦合，但 R7 的落点高亮和「子项」视觉要复用 R1 的缩进令牌，先 R1 更省事。
- R7 拆成 3 个独立可交付的步骤；R7c 已定为真层级字段（§7），属于数据模型改动，需要先定案再动手。

## 2. 需求明细

### R1 子元素统一缩进（由子任务扩展到所有内联子列表）

**现状**

- 任务列表：子任务行相对主任务行右移 20px，缩进区内用 `w-5 self-stretch` 槽位在中线画 1px 竖线（`bg-border-strong`）。这个「20px 槽位」契约被 `src/features/tasks/__tests__/task-views.test.tsx` 钉住（`SubtaskRow.tsx:16-26` 有说明）。
- 侧边栏命名空间分组（`AppShell.tsx` 两处：活动分组 L325、归档分组 L400）：`ml-3.5 … border-l border-border pl-1.5` —— 缩进 14px、引导线在 14px、内容在 21px，且引导线用的是 `border` 而非 `border-strong`。同一串类名重复了两次。
- 任务详情弹窗的 `SubtaskList`、命名空间页的项目卡片列表：子项位于独立面板/整页，不属于「同一列表内联子项」，**不缩进**。

**目标**：把「子项相对父项右移一个缩进单位（20px）+ 缩进区中线 1px 引导线（`border-strong`）」定为唯一规则，抽成一个共享令牌，所有内联子列表统一使用；规则适用范围明确为「同一列表内联展开的子项」（侧边栏分组、任务列表子任务行）。

**落地**：`src/index.css` 用 Tailwind v4 的 `@utility child-indent` 定义一次（CSS-first，不新增文件），`AppShell.tsx` 两处替换，`SubtaskRow` 保留现有槽位并把注释指向同一条规则。若容器式与行式差异无法用一个 utility 表达，退化方案是 `src/common/components/child-list.tsx` 一个 `<ChildList>` 包装组件（二选一，优先 CSS）。

**验收**：侧边栏子项与任务列表子项的左边界一致（20px）、引导线颜色粗细一致；`task-views.test.tsx` 的 gutter 契约仍通过或按新规则更新；`app-shell-sidebar.test.tsx` 补一条断言。

**复杂度**：小（纯样式 + 消除一处重复类名）。无后端、无迁移。

---

### R2 项目不设截止日期

**现状**：`projects.due_at` 贯穿全栈 —— `Project` 模型、`project:create/update` 入参、项目编辑弹窗的「截止日期」字段、项目详情头部「截止：…」、`ProjectProgress`（`dueAt` prop → 「距截止还有 N 天 / 已逾期」）、命名空间页卡片（两处 `ProjectProgress` 调用）。

**范围界定**：只删项目维度。任务/子任务的 `dueAt` 与提前提醒/到期提醒**不受影响**（提醒链只读 task/subtask 的 `due_at`，见 `services.rs::due_kinds` 调用点）。

**落地（推荐整条移除，不留永远为 null 的死字段）**

- 前端：`projects/types.ts`（3 处）、`projects/hooks.ts`（乐观补丁与 create 默认值）、`ProjectEditorDialog.tsx`（字段 + zod + `FormField`）、`ProjectListView.tsx`（头部一行 + 传参）、`ProjectProgress.tsx`（prop + `due` memo + JSX）、`NamespaceProjectsView.tsx`（2 处调用），以及对应测试。
- 后端：`models.rs::Project.due_at` 与 camelCase 字段测试、`repositories.rs`（`project_from_row` / `insert` / `update` / `sample_project`）、`services.rs`（create/update 的 `Patch` 分支）。
- 迁移：新增 `src-tauri/migrations/V6__drop_project_due_at.sql`（`ALTER TABLE projects DROP COLUMN due_at;`）。旧备份 JSON 里多出的 `dueAt` 键 serde 默认忽略，导入不受影响（不做 `deny_unknown_fields`）。
- 文档：PRD §2.2「项目模型字段」「进度视图（距截止日剩余时间）」两处改写；IMPLEMENTATION_PLAN 的 ST-03 描述同步。

**更省事的一半**：只删前端，保留数据库列与模型字段。省一次迁移，代价是模型/IPC 类型/PRD 里留一个永远为 null 的字段。想先看效果可以先做这一半（见 §5.5）。

**复杂度**：中（机械但跨前后端，含迁移与测试）。

---

### R3 新建时不指定颜色 → 随机颜色

**现状**：`src/common/colors.ts` 导出 10 色调色板；`ColorSwatches` 有「无」选项（`null`）；新建弹窗默认 `color = null`。

**范围界定**：`Task` 模型**没有颜色字段**，任务行展示的是优先级/状态徽标，不存在「任务颜色」；本需求实际覆盖拥有颜色列的实体：**命名空间、项目、标签**（三者都有创建入口与颜色控件）。

**落地**：`src/common/colors.ts` 增加 `randomColor()`；在**创建收口**取默认值，即 `createProject` / `createNamespace` / `createTag`（`features/*/hooks.ts`）中 `color: input.color ?? randomColor()`。这样侧边栏入口、命名空间页入口、R5 的项目弹窗内联新建、标签管理弹窗四条创建路径自动一致，编辑路径不受影响。另外在**新建**模式的表单里用 `randomColor()` 预置颜色，让色板预览与最终落库值一致（避免「预览显示无、结果有颜色」的错觉）。

**验收**：新建时不点颜色 → 落库 `COLORS` 中的某个色值；点选颜色 → 用点选值；编辑时清成「无」→ 仍为 `null`，不随机；三个域各有测试覆盖。

**复杂度**：很小（一个函数 + 两处收口 + 一处预置 + 测试）。

---

### R4 新建命名空间入口与项目一致（「项目　＋」）

**现状**：项目区是 `<p>项目</p>` + 右侧 `＋` 图标按钮（`AppShell.tsx` L296–307）；命名空间用的是列表下方整宽的「＋ 新建命名空间」文字按钮（L332–345）。

**目标**：命名空间区使用与项目区完全相同的「标题 + 右侧 ＋」形式，删除整宽按钮。

**位置（已定）**：两段式 —— `项目 ＋` 保持为整个项目树的段标题（其 `＋` 建根级项目），在命名空间列表**之上**插入同款 `命名空间 ＋` 标题行（其 `＋` 建命名空间）：

```
项目                    ＋
命名空间                ＋
  ▸ 工作 (2)
  ▸ 生活 (1)
  项目 A
  项目 B
```

**验收**：折叠侧边栏时不渲染标题行（与项目区一致）；`＋` 打开现有 `NamespaceEditorDialog`；`app-shell-sidebar.test.tsx` 补断言。

**复杂度**：很小（纯 JSX，无状态、无数据流变化）。

---

### R5 新建项目时可顺手新建命名空间

**现状**：`ProjectEditorDialog` 的命名空间 `Select` 只列「不归属 + 活动命名空间（+ 已归档/未知兜底）」；新建命名空间必须离开弹窗去侧边栏入口。

**目标**：在同一个弹窗内完成「建命名空间 → 项目归入它」，一次提交。

**方案（推荐）**：`Select` 末尾增加哨兵选项「＋ 新建命名空间…」（值用 `__new__` 这类真字符串，沿用现有 `NOT_FILED` 的哨兵写法——Kobalte 把 `""` 读作「未选中」）；选中后在 Select 下方就地展开「命名空间名称」输入框，提交时：

1. `createNamespace({ name })` → 拿到 id；
2. `createProject({ ...payload, namespaceId: 新 id })`。

任一步失败：弹窗保持打开，沿用现有 hooks 的通知机制报错。第二步失败时命名空间已建好，弹窗留在原地、已建 id 记在本地状态里，重试复用该 id 而不是重复创建。

**备选（不推荐）**：Select 标题旁放 `＋`，嵌套打开现有 `NamespaceEditorDialog`。Kobalte 两个 Dialog 的 Portal/焦点陷阱嵌套容易出问题，代码量也没更少。

**验收**：一次提交后命名空间存在且项目归属正确；取消不留下空命名空间；名称校验与 `NamespaceEditorDialog` 一致（trim 后非空）；新建的命名空间自动获得 R3 的随机颜色。

**复杂度**：小–中（弹窗内状态机 + 二次写 + 测试）。

---

### R6 日期/时间控件空值文案统一为「年/月/日 时:分」

**现状**：5 个原生日期控件，空值时的分段文案由 **WebView 自身 UI 语言**渲染，CSS 与属性都无法覆盖。

| 文件 | 控件 | 备注 |
|------|------|------|
| `TaskEditorDialog.tsx:236` | `datetime-local` | 渲染为 `yyyy/mm/日 --:--`（年月英文 + 中文「日」混排） |
| `SubtaskEditor.tsx:107` | `datetime-local` | 同上 |
| `TimeTracker.tsx:129` | `datetime-local` | 同上 |
| `ProjectEditorDialog.tsx:216` | `date` | R2 会删除该字段 |
| `QuickAddWindow.tsx:269` | `date` | 纯日期，空值显示「年/月/日」 |

**目标（已定）**：日期时间字段空值统一显示「年/月/日 时:分」，纯日期字段显示「年/月/日」。**不引入秒**：保持 `datetime-local` 的默认分钟精度，不改 `step`，值域与格式化工具（`datetime.ts` / `time.ts`）都不动。

**方案**：新增 `src/common/components/date-field.tsx` —— 保留原生 input（原生日历/时间选择器不丢），空值且未聚焦时把原生分段文字隐藏（`::-webkit-datetime-edit { opacity: 0 }`），叠加一个 `aria-hidden` 的自绘占位文本；聚焦后交还原生分段编辑。CSS 只需 `src/index.css` 一条：

```css
.date-field[data-empty]:not(:focus-within)::-webkit-datetime-edit { opacity: 0; }
```

5 个调用点改为 `<DateField type="date|datetime-local" …>`（透传 value/onChange/aria-label/class），`type="date"` 的占位文案为「年/月/日」。

**验收**：5 个控件空值文案一致（纯日期不含时间部分）；填入值仍能正确落库/回显，分钟精度不变；未填不影响提交。

**复杂度**：小–中（一个新共享控件 + 一条 CSS + 5 个调用点）。

---

### R7 拖拽（长按）调整归属

**现状与可复用资产**

- 原生 Drag API 已在看板落地（P-05 ✅）：`BoardCard` `draggable` + `dataTransfer.setData("text/plain", id)` + 列上 `onDragOver/onDrop`。AGENTS.md 明确不引入拖拽库，本需求复用同一模式。
- 侧边栏当前**不显示任务**（只有搜索/任务视图/命名空间+项目/其他），所以「任务拖到其他项目」必然是**从任务列表（项目页、收件箱、今天、即将到来、看板卡片）拖到侧边栏的项目行**；「任务 → 任务」的两个落点都在任务列表内部。
- 数据层能力（决定三块的难易）：
  - **项目 → 命名空间**：`project:update { namespaceId }` 已存在（命名空间页已有「移出命名空间」）。✅
  - **任务 → 项目**：`task:update { projectId }` 已存在。✅ 但任务编辑弹窗目前**没有**项目选择器，「移动任务」今天没有键盘可达路径。
  - **任务 → 任务**：数据模型**没有**任务层级字段，`subtasks` 是独立表，需要产品决策（§5.1）。
- 项目/命名空间**没有** reorder 命令，拖放只改归属、不改顺序（`sort_order` 保持建时生成的键），这也让 R7a/R7b 不需要碰排序键。

**R7a 项目 → 命名空间（中）**
侧边栏项目行 `draggable`，命名空间分组行作落点；落下调用 `updateProject(id, { namespaceId })`。要点：`dataTransfer` 里带实体类型（`project` / `task`）避免跨类型误落；拖拽过程只改 transform；落点高亮用 `border-primary/60` 一类仅样式变化；拖到根级项目区/侧边栏空白 = `namespaceId: null`（移出命名空间）。

**R7b 任务 → 项目（中–大）**
任务行加 `draggable`（`TaskItemRow`、`BoardCard`），侧边栏项目行作落点 → `updateTask(id, { projectId })`。要点：跨项目后视图按现有派生自动更新；一次拖拽只发一次 IPC；拖拽期间侧边栏需要可见（当前布局已满足）。

**R7c 任务 → 任务 = 子任务（大）**
已定：给 `tasks` 加自引用层级字段（不是「复制 + 软删」），因此拖过去能保留标签/评论/计时/依赖。落地前需先定案 §7（与 `subtasks` 的关系、级联与可见性、深度、落点规则）；实现时还需要：拖到任务行上时高亮该行、落下后刷新两个任务。

**长按语义（已定）**：鼠标立即拖、触摸长按。实现上不自己加计时器：行一律 `draggable={true}`，触摸端由平台自身的长按起步（Chromium 在触摸下本来就是长按才起拖，且快速滑动仍是滚动），鼠标端按下即可拖。

**a11y / 可发现性**：拖拽不能是唯一路径。建议与 R7 同批补两处键盘路径 —— 任务编辑弹窗增加「项目」选择器、侧边栏项目行增加「移入命名空间…」菜单项（命名空间页已有「移出命名空间」，可对齐）。

**测试**：jsdom 中合成 `dragstart/dragover/drop`（看板测试已有先例），断言落库调用参数与归属变化；长按计时用假定时器。

**复杂度**：大（三块；R7c 是数据模型改动，见 §7）。

## 3. 不纳入本次范围（YAGNI）

- 不引入任何拖拽/动画库（沿用原生 Drag API + CSS transition，AGENTS.md 已约定）。
- 不为拖放增加「目标顺序」能力（项目/命名空间无 reorder 命令，改归属即可）。
- 不给任务新增颜色字段（R3 覆盖已有颜色列的实体：命名空间/项目/标签）。
- 不重构 `TagManagerDialog` 里那份与 `common/components/palette-picker.tsx` 重复的本地色板（R3 只加随机默认值，不做色板合并）。

## 4. 实施阶段

| 阶段 | 内容 | 出口 |
|------|------|------|
| P1 | R4 + R3 | 侧边栏两个「标题 ＋」区域一致；新建命名空间/项目/标签（不点颜色）落库随机色 |
| P2 | R1 + R5 | 子项缩进规则统一；项目弹窗内可建命名空间并正确归属 |
| P3 | R2 + R6 | 项目维度无截止日期（含 V6 迁移）；5 个日期控件空值文案统一为「年/月/日 时:分」 |
| P4 | R7a | 项目可拖入/拖出命名空间 ✅ |
| P5 | R7b | 任务可拖到其他项目 ✅ |
| P6 | R7c | 任务可拖成另一个任务的子任务（真层级字段，待 §7 设计） |

每阶段一个（或数个）提交，提交信息遵循现有 `feat: / fix: / docs:` 前缀；每阶段结束跑
`pnpm typecheck && pnpm test`，涉及 Rust 的阶段额外跑 `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`。

## 5. 已定决策与待确认问题

**已定（2026-09-15 评审）**

| 编号 | 决策 |
|------|------|
| R2 | 整条移除：界面 + 模型字段 + `V6` 迁移删列，PRD/类型/测试全清 |
| R3 | 覆盖命名空间 + 项目 + 标签；任务无颜色字段，不涉及 |
| R4 | 两段式：`命名空间 ＋` 标题行插在 `项目 ＋` 下方 |
| R6 | 文案统一为「年/月/日 时:分」，**不引入秒**，`step` 与时间格式化工具不动 |
| R7 长按 | 鼠标立即拖；触摸长按由平台自身的长按起步实现，不自己加计时器 |
| R7c | 采用**真层级字段** `tasks.parent_task_id`（不做「复制 + 软删」）。这是数据模型级改动，需要先出设计再实现 —— 见 §7 |

**待确认（进入 R7c 前需要）**

见 §7：`parent_task_id` 与既有 `subtasks` 的关系是这次改动的核心问题，需要先定案。

## 6. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09-15 | 初稿：记录 R1–R7，按复杂度排序并给出实施阶段 |
| 2026-09-15 | 评审：R2 整条移除、R3 含标签、R4 两段式、R6 改为「年/月/日 时:分」不引入秒；P3 的 R6 复杂度由「中」降为「小–中」 |
| 2026-09-15 | P1（R4+R3）落地：`c71fc66` |
| 2026-09-15 | P2（R1+R5）落地：`feb834d` |
| 2026-09-15 | P4/P5（R7a+R7b）落地：共享拖拽状态 `common/stores/drag.ts`；侧边栏项目行既是拖源也是落点（R7b），命名空间行与根级项目区是落点（R7a/R7a 的「移出命名空间」）；任务行加拖源。触摸长按由平台自身实现（不自己加计时器） |
| 2026-09-15 | 评审 R7：长按取「鼠标立即拖、触摸长按」；R7c 定案为「子任务并入 `tasks` 层级 + 只允许一层 + 子任务独立进视图」，需先出 spec（§7） |
| 2026-09-15 | P3（R2+R6）落地：项目 `due_at` 全栈移除 + `V6` 迁移；`DateField` 统一 5 个日期控件（工具类 `child-indent`、`DateField` 均为共享件） |

## 7. R7c 设计（已定案，待实现）

**决策（2026-09-15）**

| 问题 | 决定 |
|------|------|
| 与 `subtasks` 的关系 | **合并**：子任务并入任务层级。子任务成为带 `parent_task_id` 的任务行，`subtasks` 表及其命令/缓存在迁移后退役 |
| 深度 | **只允许一层**：`parent_task_id` 指向的任务自身必须没有父任务 |
| 视图可见性 | **子任务也独立进视图**：「收件箱 / 今天 / 即将到来 / 已完成」的顶层列表里，有父任务的任务照常按自己的 `dueAt` / `completedAt` 出现 |

**这是一次数据模型重构，不是增量改动**，实现前需要单独一份 spec + 实施计划（按里程碑拆、每步可验收）。影响面：

- **迁移（V7）**：`tasks` 增自引用列 `parent_task_id`；把 `subtasks` 行搬进 `tasks`（标题/备注/优先级/截止/复杂度/sort_order 直接搬；`done` 是布尔而任务用 `completed_at` 时间戳，需要一个换算约定）；`subtask_dependencies` 的边改写成 `task_dependencies`；`subtask_reminders` 与 `task_reminders` 合一。
- **后端**：`subtask:*` 的 7 个命令、`services` 的子任务函数族、`repositories::subtasks`、依赖边的两个集合、提醒扫描的两轮候选、`task:list` 的返回范围（现在子任务是 `subtask:listAll` 单独拉的）。
- **前端**：`Subtask` 类型与 `subtasksByTask` 缓存、`SubtaskRow` / `SubtaskList` / `SubtaskEditor`、任务详情弹窗、列表里展开的子任务行、依赖 UI、看板卡片、统计口径。
- **语义细节（同一批定）**：父任务完成/软删时子任务的处理（现行提醒规则是父任务完成即静默子任务）；项目进度与看板是否统计子任务；删父任务时子任务级联与否；R7c 落点与 R7b 落点在同一列表里的区分（落到任务行 = 变子任务，落到侧边栏项目行 = 移项目）。
- **文档**：落地时同步 `PRD`（子任务模型改写）、`ARCHITECTURE`（V7 迁移与任务层级）、`IMPLEMENTATION_PLAN`（新增里程碑）。

**在写出这份 spec 并被评审前不动 R7c 的代码。**
