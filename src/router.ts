import { createRouter, createWebHashHistory } from "vue-router";
import ArchiveView from "./views/ArchiveView.vue";
import ProjectView from "./views/ProjectView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import WeekView from "./views/WeekView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/week" },
    { path: "/week", name: "week", component: WeekView },
    { path: "/projects", name: "projects", component: ProjectsView },
    { path: "/projects/:id", name: "project", component: ProjectView, props: true },
    { path: "/archive", name: "archive", component: ArchiveView },
  ],
});
