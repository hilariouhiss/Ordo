import type { Language } from "../lib/i18n";
import type { TaskGrouping } from "../lib/taskGroups";
import type { ThemePref } from "../lib/theme";

export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "normal" | "low";
export type DeskPin = "top" | "bottom";

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

export interface Step {
  id: string;
  taskId: string;
  title: string;
  sortOrder: number;
  done: boolean;
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
  projectId: string | null;
  /** Display name of the project, even when it is archived. */
  projectName: string | null;
  categoryId: string | null;
  ownerId: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** Local "HH:MM" a timed task is due; null for a plain day. */
  dueTime: string | null;
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
  steps: Step[];
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
  startDate?: string | null;
  note?: string | null;
  tags?: string[];
  effortMinutes?: number;
  priority?: Priority;
  exclusive?: boolean;
}

/** The five attributes a capture can carry, already resolved to ids and local dates. */
export interface CaptureFields {
  projectId: string | null;
  ownerId: string | null;
  priority: Priority;
  dueDate: string | null;
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
