/**
 * Single source of truth for Tauri command names.
 *
 * Commands follow the `<domain>:<action>` convention from ARCHITECTURE §3.2;
 * the backend registers them in `src-tauri/src/commands.rs` as milestones land.
 */
export const COMMANDS = {
  task: {
    list: "task:list",
    listByProject: "task:listByProject",
    create: "task:create",
    update: "task:update",
    complete: "task:complete",
    softDelete: "task:softDelete",
    restore: "task:restore",
    reorder: "task:reorder",
  },
  dependency: {
    listAll: "dependency:listAll",
    add: "dependency:add",
    remove: "dependency:remove",
  },
  tag: {
    list: "tag:list",
    create: "tag:create",
    update: "tag:update",
    delete: "tag:delete",
  },
  project: {
    list: "project:list",
    unfinishedCounts: "project:unfinishedCounts",
    create: "project:create",
    update: "project:update",
    archive: "project:archive",
    restore: "project:restore",
    delete: "project:delete",
  },
  namespace: {
    list: "namespace:list",
    create: "namespace:create",
    update: "namespace:update",
    archive: "namespace:archive",
    restore: "namespace:restore",
    delete: "namespace:delete",
  },
  board: {
    listColumns: "board:listColumns",
    moveTask: "board:moveTask",
  },
  search: {
    query: "search:query",
  },
  comment: {
    list: "comment:list",
    create: "comment:create",
    update: "comment:update",
    delete: "comment:delete",
  },
  time: {
    list: "time:list",
    running: "time:running",
    create: "time:create",
    update: "time:update",
    delete: "time:delete",
    start: "time:start",
    stop: "time:stop",
  },
  stats: {
    trend: "stats:trend",
    projectProgress: "stats:projectProgress",
    timeDistribution: "stats:timeDistribution",
  },
  backup: {
    export: "backup:export",
    import: "backup:import",
  },
  perf: {
    ready: "perf:ready",
  },
} as const;

type ValueOf<T> = T[keyof T];

/** Union of every valid command string. */
export type AppCommand = ValueOf<{
  [Domain in keyof typeof COMMANDS]: ValueOf<(typeof COMMANDS)[Domain]>;
}>;
