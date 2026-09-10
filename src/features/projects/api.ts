/**
 * Backend calls for the project domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns the optimistic-update flow.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { NewProject, Project, UpdateProject } from "./types";

// --- project:* ---------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return invokeCommand(COMMANDS.project.list);
}

export function createProject(payload: NewProject): Promise<Project> {
  return invokeCommand(COMMANDS.project.create, { payload });
}

export function updateProject(projectId: string, payload: UpdateProject): Promise<Project> {
  return invokeCommand(COMMANDS.project.update, { projectId, payload });
}

export function archiveProject(projectId: string): Promise<Project> {
  return invokeCommand(COMMANDS.project.archive, { projectId });
}

export function restoreProject(projectId: string): Promise<Project> {
  return invokeCommand(COMMANDS.project.restore, { projectId });
}
