import { computed, reactive } from "vue";
import { bootstrap } from "../model/ipc";
import type {
  Bootstrap,
  Category,
  Person,
  ProjectSummary,
  Settings,
  Tag,
  Task,
} from "../model/types";

export function createAppVM() {
  const state = reactive({
    ready: false,
    people: [] as Person[],
    categories: [] as Category[],
    tags: [] as Tag[],
    settings: null as Settings | null,
    projects: [] as ProjectSummary[],
    week: [] as Task[],
  });

  async function load(): Promise<void> {
    const data: Bootstrap = await bootstrap();
    state.people = data.people;
    state.categories = data.categories;
    state.tags = data.tags;
    state.settings = data.settings;
    state.projects = data.projects;
    state.week = data.week;
    state.ready = true;
  }

  const me = computed(() => state.people.find((p) => p.isMe) ?? null);

  return { state, me, load };
}

export const appVM = createAppVM();
