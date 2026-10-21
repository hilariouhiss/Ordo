import { createRouter, createWebHashHistory } from "vue-router";
import ArchiveView from "./views/ArchiveView.vue";
import CategoriesView from "./views/CategoriesView.vue";
import PeopleView from "./views/PeopleView.vue";
import ProjectView from "./views/ProjectView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import TagsView from "./views/TagsView.vue";
import TasksView from "./views/TasksView.vue";
import WeekView from "./views/WeekView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/week" },
    { path: "/week", name: "week", component: WeekView },
    { path: "/tasks", name: "tasks", component: TasksView },
    { path: "/projects", name: "projects", component: ProjectsView },
    { path: "/projects/:id", name: "project", component: ProjectView, props: true },
    { path: "/categories", name: "categories", component: CategoriesView },
    { path: "/tags", name: "tags", component: TagsView },
    { path: "/people", name: "people", component: PeopleView },
    { path: "/archive", name: "archive", component: ArchiveView },
  ],
});
