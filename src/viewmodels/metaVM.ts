import * as ipc from "../model/ipc";
import { appVM } from "./appVM";

export function createMetaVM() {
  async function addCategory(name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.createCategory(name.trim());
    await appVM.load();
  }

  async function renameCategory(id: string, name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.renameCategory(id, name.trim());
    await appVM.load();
  }

  async function removeCategory(id: string): Promise<void> {
    await ipc.deleteCategory(id);
    await appVM.load();
  }

  async function moveCategory(id: string, direction: -1 | 1): Promise<void> {
    const ids = appVM.state.categories.map((c) => c.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    appVM.state.categories = await ipc.reorderCategories(ids);
  }

  async function addTag(name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.createTag(name.trim());
    await appVM.load();
  }

  async function removeTag(id: string): Promise<void> {
    await ipc.deleteTag(id);
    await appVM.load();
  }

  async function addPerson(name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.createPerson(name.trim());
    await appVM.load();
  }

  async function renamePerson(id: string, name: string): Promise<void> {
    if (!name.trim()) return;
    await ipc.renamePerson(id, name.trim());
    await appVM.load();
  }

  async function removePerson(id: string): Promise<void> {
    await ipc.deletePerson(id);
    await appVM.load();
  }

  return {
    addCategory,
    renameCategory,
    removeCategory,
    moveCategory,
    addTag,
    removeTag,
    addPerson,
    renamePerson,
    removePerson,
  };
}

export const metaVM = createMetaVM();
