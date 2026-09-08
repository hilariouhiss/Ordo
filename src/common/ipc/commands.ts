/**
 * Single source of truth for Tauri command names.
 *
 * Commands follow the `<domain>:<action>` convention from ARCHITECTURE §3.2;
 * the backend registers them in `src-tauri/src/commands.rs` as milestones land.
 */
export const COMMANDS = {
  task: {
    list: "task:list",
    create: "task:create",
    update: "task:update",
    complete: "task:complete",
    softDelete: "task:softDelete",
    restore: "task:restore",
  },
  subtask: {
    list: "subtask:list",
    create: "subtask:create",
    update: "subtask:update",
    complete: "subtask:complete",
    delete: "subtask:delete",
    reorder: "subtask:reorder",
  },
  tag: {
    list: "tag:list",
    create: "tag:create",
    update: "tag:update",
    delete: "tag:delete",
  },
  project: {
    list: "project:list",
    create: "project:create",
    update: "project:update",
    archive: "project:archive",
    restore: "project:restore",
  },
  board: {
    listColumns: "board:listColumns",
    addColumn: "board:addColumn",
    updateColumn: "board:updateColumn",
    deleteColumn: "board:deleteColumn",
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
  settings: {
    get: "settings:get",
    set: "settings:set",
  },
  backup: {
    export: "backup:export",
    import: "backup:import",
  },
} as const;

type ValueOf<T> = T[keyof T];

/** Union of every valid command string. */
export type AppCommand = ValueOf<{
  [Domain in keyof typeof COMMANDS]: ValueOf<(typeof COMMANDS)[Domain]>;
}>;
