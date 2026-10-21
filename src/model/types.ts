import type { Language } from "../lib/i18n";
import type { ThemePref } from "../lib/theme";

export type Status = "todo" | "doing" | "done";

export interface Person {
  id: string;
  name: string;
  isMe: boolean;
  color: string | null;
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
  aiHasKey: boolean;
  shortcut: string;
  autostart: boolean;
  backupKeepDays: number;
  lastPassWeek?: string;
}

export interface Project {
  id: string;
  name: string;
  dueDate: string | null;
  archivedAt: string | null;
  memberIds: string[];
}

export interface Step {
  id: string;
  taskId: string;
  title: string;
  sortOrder: number;
  done: boolean;
  dueDate: string | null;
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
  categoryId: string | null;
  ownerId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: Status;
  inWeek: boolean;
  carryCount: number;
  suspendedUntil: string | null;
  note: string | null;
  archivedAt: string | null;
  canceledAt: string | null;
  steps: Step[];
  tags: Tag[];
  delays: Delay[];
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  effortDays: number;
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
  dueDate: string | null;
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
  passNeeded: boolean;
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
  effortDays?: number;
}
export interface ArchiveData {
  projects: Project[];
  tasks: Task[];
  canceled: Task[];
  done: Task[];
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
