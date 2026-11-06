import type { Language } from "../lib/i18n";
import type { TaskGrouping } from "../lib/taskGroups";
import type { ThemePref } from "../lib/theme";

export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "normal" | "low";
export type DeskPin = "top" | "bottom";
export type WeekView = "list" | "gantt";

/** The task-page narrowing: text plus one value per facet, combined with AND. */
export interface TaskFilter {
  query: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  tagId: string | null;
  priority: Priority | null;
}

/** A named task-page filter; the grouping travels with it. */
export interface SavedTaskView {
  id: string;
  name: string;
  groupBy: TaskGrouping;
  filter: TaskFilter;
}

export type SearchHitKind = "task" | "project";
export type SearchHitState = "active" | "done" | "archived" | "canceled";

/** One global-search row: a task in any state, or a live project. */
export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  title: string;
  /** The project name for tasks; null for projects and loose tasks. */
  subtitle: string | null;
  state: SearchHitState;
}

export interface Person {
  id: string;
  name: string;
  isMe: boolean;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Settings {
  theme: ThemePref;
  language: Language;
  shortcutWarning?: string | null;
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  shortcut: string;
  deskShortcut: string;
  deskShortcutWarning?: string | null;
  mainShortcut: string;
  mainShortcutWarning?: string | null;
  autostart: boolean;
  backupKeepDays: number;
  backupError: string | null;
  lastPassWeek?: string;
  deskEnabled: boolean;
  deskControls: boolean;
  deskPin: DeskPin;
  deskX: number | null;
  deskY: number | null;
  tasksGroupBy: TaskGrouping;
  weekShowEmptyDays: boolean;
  weekView: WeekView;
  savedTaskViews: SavedTaskView[];
  /** Minutes a reminder fires before a task's own moment; 0 keeps the built-in times. */
  remindersLeadMinutes: number;
  /** Whether the daily 09:00 digest fires. */
  remindersDigest: boolean;
}

export interface ProjectMember {
  personId: string;
  categoryId: string | null;
}

export interface Project {
  id: string;
  name: string;
  groupId: string | null;
  priority: Priority;
  archivedAt: string | null;
  members: ProjectMember[];
}

export interface ProjectGroup {
  id: string;
  name: string;
}

export interface Delay {
  id: string;
  taskId: string;
  kind: "reschedule" | "overdue_note";
  oldDue: string | null;
  newDue: string | null;
  reason: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  /** Set on a subtask: the task it belongs to. */
  parentId: string | null;
  /** Display title of the parent, so a subtask card names its umbrella. */
  parentTitle: string | null;
  projectId: string | null;
  /** Display name of the project, even when it is archived. */
  projectName: string | null;
  categoryId: string | null;
  ownerId: string | null;
  /** Local `YYYY-MM-DD` the work is planned to begin. */
  expectedStartDate: string | null;
  /** Local `YYYY-MM-DD` the work is planned to be finished. */
  expectedFinishDate: string | null;
  /** Local "HH:MM" a timed task is due; null for a plain day. */
  expectedFinishTime: string | null;
  /** RFC3339 UTC stamp of when the task actually started. */
  actualStartAt: string | null;
  /** RFC3339 UTC stamp of when the task was actually finished. */
  actualFinishAt: string | null;
  /** Minutes the work really took, filled in when the task is completed. */
  actualEffortMinutes: number | null;
  status: Status;
  inWeek: boolean;
  carryCount: number;
  suspendedUntil: string | null;
  suspended: boolean;
  suspendedAt: string | null;
  suspendReason: string | null;
  note: string | null;
  archivedAt: string | null;
  canceledAt: string | null;
  /** Live child tasks; a task with children derives its effort, dates and status from them. */
  children: Task[];
  tags: Tag[];
  delays: Delay[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  effortMinutes: number;
  priority: Priority;
  exclusive: boolean;
}

/** A recurring rule: the weekday set and time a task appears at. */
export interface TaskRule {
  id: string;
  title: string;
  /** ISO weekdays, Monday = 1 … Sunday = 7. */
  weekdays: number[];
  /** Local "HH:MM". */
  at: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  priority: Priority;
  effortMinutes: number;
  exclusive: boolean;
  enabled: boolean;
}

/** The attribute block a rule and a template share, edited by one component. */
export interface TaskAttrs {
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  priority: Priority;
  effortMinutes: number;
  exclusive: boolean;
}

/** An absent id creates a rule; a present one rewrites that rule. */
export interface RuleInput extends TaskAttrs {
  id?: string | null;
  title: string;
  weekdays: number[];
  at: string;
}

/** A fixed flow: the attributes and step titles every new task starts with. */
export interface TaskTemplate {
  id: string;
  name: string;
  projectId: string | null;
  categoryId: string | null;
  ownerId: string | null;
  priority: Priority;
  effortMinutes: number;
  exclusive: boolean;
  note: string | null;
  steps: string[];
}

export interface TemplateInput extends TaskAttrs {
  id?: string | null;
  name: string;
  note: string | null;
  steps: string[];
}

export interface CategoryProgress {
  categoryId: string;
  name: string;
  total: number;
  done: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  groupId: string | null;
  priority: Priority;
  total: number;
  done: number;
  byCategory: CategoryProgress[];
}

export interface WeekStats {
  added: number;
  done: number;
  delayed: number;
}

/** One local day with activity; the statistics page fills the quiet days in. */
export interface DayStats {
  date: string;
  completed: number;
  created: number;
}

/** Completed work grouped by project or category; both ids are null when unset. */
export interface StatsSlice {
  id: string | null;
  name: string | null;
  completed: number;
  minutes: number;
}

export interface StatsOverview {
  from: string;
  to: string;
  completed: number;
  created: number;
  completedMinutes: number;
  onTime: number;
  withDue: number;
  delayed: number;
  daily: DayStats[];
  byProject: StatsSlice[];
  byCategory: StatsSlice[];
  previousCompleted: number;
  previousMinutes: number;
  previousOnTime: number;
  previousWithDue: number;
  previousDelayed: number;
}

export interface Bootstrap {
  people: Person[];
  categories: Category[];
  tags: Tag[];
  settings: Settings;
  projects: ProjectSummary[];
}

export type PassAction = "keep" | "done" | "suspend" | "cancel";
/** An absent field keeps its value; an explicit `null` clears it. */
export interface TaskPatch {
  title?: string;
  projectId?: string | null;
  categoryId?: string | null;
  ownerId?: string | null;
  expectedStartDate?: string | null;
  expectedFinishDate?: string | null;
  actualStartAt?: string | null;
  actualFinishAt?: string | null;
  actualEffortMinutes?: number | null;
  note?: string | null;
  tags?: string[];
  effortMinutes?: number;
  priority?: Priority;
  exclusive?: boolean;
}

/** The attributes a capture can carry, already resolved to ids. The expected finish
 * is not one of them: it always follows the estimate. */
export interface CaptureFields {
  projectId: string | null;
  ownerId: string | null;
  priority: Priority;
  effortMinutes: number;
}
export interface ArchiveTask {
  id: string;
  title: string;
  archivedAt: string | null;
  canceledAt: string | null;
}
export interface ArchiveData {
  projects: Project[];
  tasks: ArchiveTask[];
  canceled: ArchiveTask[];
  done: ArchiveTask[];
}
export interface ShortcutOutcome {
  active: string;
  warning: string | null;
}
export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  sample: string | null;
  error: string | null;
}
