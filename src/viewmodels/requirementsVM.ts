import { reactive } from "vue";
import { readBase64 } from "../lib/fileBytes";
import { DOCUMENT_MAX_BYTES } from "../lib/limits";
import * as ipc from "../model/ipc";
import type {
  ProjectDocument,
  ProjectDocumentDetail,
  Requirement,
  RequirementChange,
  RequirementPatch,
  RequirementStatus,
} from "../model/types";

/** A pipeline row while it is being edited; a null id marks a new status. */
export interface PipelineEntry {
  id: string | null;
  name: string;
}

export function createRequirementsVM() {
  const state = reactive({
    projectId: null as string | null,
    statuses: [] as RequirementStatus[],
    requirements: [] as Requirement[],
    documents: [] as ProjectDocument[],
    error: null as string | null,
    loading: false,
    uploading: false,
    openDocumentId: null as string | null,
    document: null as ProjectDocumentDetail | null,
    selectedSectionId: null as string | null,
    focusRequirementId: null as string | null,
    changesFor: null as string | null,
    changes: [] as RequirementChange[],
  });

  let run = 0;

  async function load(projectId: string): Promise<void> {
    const current = ++run;
    state.loading = true;
    try {
      const [statuses, requirements, documents] = await Promise.all([
        ipc.listRequirementStatuses(projectId),
        ipc.listRequirements(projectId),
        ipc.listProjectDocuments(projectId),
      ]);
      if (current !== run) return;
      if (state.projectId !== projectId) {
        state.openDocumentId = null;
        state.document = null;
        state.selectedSectionId = null;
        state.focusRequirementId = null;
        state.changesFor = null;
        state.changes = [];
      }
      state.projectId = projectId;
      state.statuses = statuses;
      state.requirements = requirements;
      state.documents = documents;
    } finally {
      if (current === run) state.loading = false;
    }
  }

  async function reload(): Promise<void> {
    if (state.projectId) await load(state.projectId);
  }

  /** One failed write is shown inline; its reload failing is a different problem. */
  async function write(action: () => Promise<unknown>): Promise<boolean> {
    state.error = null;
    try {
      await action();
    } catch (e) {
      state.error = String(e);
      return false;
    }
    try {
      await reload();
    } catch (e) {
      state.error = String(e);
    }
    return true;
  }

  async function add(projectId: string, title: string): Promise<boolean> {
    const name = title.trim();
    if (!name) return false;
    return write(() => ipc.createRequirement(projectId, name));
  }

  async function update(id: string, patch: RequirementPatch): Promise<boolean> {
    return write(() => ipc.updateRequirement(id, patch));
  }

  async function remove(id: string): Promise<boolean> {
    return write(() => ipc.deleteRequirement(id));
  }

  async function advance(id: string): Promise<boolean> {
    return write(() => ipc.advanceRequirement(id));
  }

  async function linkSection(requirementId: string, sectionId: string): Promise<boolean> {
    return write(() => ipc.linkRequirementSection(requirementId, sectionId));
  }

  async function unlinkSection(requirementId: string, sectionId: string): Promise<boolean> {
    return write(() => ipc.unlinkRequirementSection(requirementId, sectionId));
  }

  async function linkTask(requirementId: string, taskId: string): Promise<boolean> {
    return write(() => ipc.updateTaskPatch(taskId, { requirementId }));
  }

  async function unlinkTask(taskId: string): Promise<boolean> {
    return write(() => ipc.updateTaskPatch(taskId, { requirementId: null }));
  }

  async function createTask(requirementId: string, title: string): Promise<boolean> {
    const name = title.trim();
    if (!name) return false;
    return write(() => ipc.createRequirementTask(requirementId, name));
  }

  async function saveStatuses(entries: PipelineEntry[]): Promise<boolean> {
    if (!state.projectId) return false;
    const payload = entries.map((entry) => ({
      id: entry.id,
      name: entry.name.trim(),
    }));
    return write(() => ipc.saveRequirementStatuses(state.projectId as string, payload));
  }

  async function createFromSection(
    sectionId: string,
    title: string,
    quote: string,
  ): Promise<boolean> {
    let created: Requirement | null = null;
    const ok = await write(async () => {
      created = await ipc.createRequirementFromSection(sectionId, title, quote);
    });
    if (ok && created) {
      closeDocument();
      focus((created as Requirement).id);
    }
    return ok;
  }

  async function upload(projectId: string, file: File): Promise<boolean> {
    state.error = null;
    if (file.size > DOCUMENT_MAX_BYTES) {
      state.error = "document_too_large";
      return false;
    }
    state.uploading = true;
    try {
      const base64 = await readBase64(file);
      let created: ProjectDocument | null = null;
      const ok = await write(async () => {
        created = await ipc.importDocument(projectId, file.name, base64);
      });
      if (ok && created) await openDocument((created as ProjectDocument).id);
      return ok;
    } catch (e) {
      state.error = String(e);
      return false;
    } finally {
      state.uploading = false;
    }
  }

  async function openDocument(id: string): Promise<void> {
    state.error = null;
    try {
      const document = await ipc.getDocument(id);
      state.document = document;
      state.openDocumentId = id;
      state.selectedSectionId = document.sections[0]?.id ?? null;
    } catch (e) {
      state.error = String(e);
    }
  }

  function closeDocument(): void {
    state.openDocumentId = null;
    state.document = null;
    state.selectedSectionId = null;
  }

  function selectSection(id: string): void {
    state.selectedSectionId = id;
  }

  async function linkSectionRequirement(sectionId: string, requirementId: string): Promise<void> {
    if (await linkSection(requirementId, sectionId)) await refreshOpenDocument();
  }

  async function unlinkSectionRequirement(sectionId: string, requirementId: string): Promise<void> {
    if (await unlinkSection(requirementId, sectionId)) await refreshOpenDocument();
  }

  async function refreshOpenDocument(): Promise<void> {
    if (!state.openDocumentId) return;
    try {
      state.document = await ipc.getDocument(state.openDocumentId);
    } catch (e) {
      state.error = String(e);
    }
  }

  async function deleteDocument(id: string): Promise<boolean> {
    const ok = await write(() => ipc.deleteDocument(id));
    if (ok && state.openDocumentId === id) closeDocument();
    return ok;
  }

  async function loadChanges(requirementId: string): Promise<void> {
    if (state.changesFor === requirementId) {
      state.changesFor = null;
      state.changes = [];
      return;
    }
    state.error = null;
    try {
      state.changes = await ipc.listRequirementChanges(requirementId);
      state.changesFor = requirementId;
    } catch (e) {
      state.error = String(e);
    }
  }

  function focus(id: string): void {
    state.focusRequirementId = id;
  }

  function statusOf(requirement: Requirement): RequirementStatus | null {
    return (
      state.statuses.find((status) => status.id === requirement.statusId) ??
      state.statuses[0] ??
      null
    );
  }

  function nextStatus(requirement: Requirement): RequirementStatus | null {
    const index = state.statuses.findIndex((status) => status.id === requirement.statusId);
    if (index < 0) return state.statuses[1] ?? null;
    return state.statuses[index + 1] ?? null;
  }

  return {
    state,
    load,
    reload,
    add,
    update,
    remove,
    advance,
    linkSection,
    unlinkSection,
    linkTask,
    unlinkTask,
    createTask,
    saveStatuses,
    createFromSection,
    upload,
    openDocument,
    closeDocument,
    selectSection,
    linkSectionRequirement,
    unlinkSectionRequirement,
    deleteDocument,
    loadChanges,
    focus,
    statusOf,
    nextStatus,
  };
}

export const requirementsVM = createRequirementsVM();
