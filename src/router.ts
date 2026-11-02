import { createRouter, createWebHashHistory } from "vue-router";

// Views load on first visit: the shell only ever shows one page, so keeping them
// out of the entry chunk makes the first paint smaller and faster.
const WeekView = () => import("./views/WeekView.vue");
const TasksView = () => import("./views/TasksView.vue");
const TemplatesView = () => import("./views/TemplatesView.vue");
const ProjectsView = () => import("./views/ProjectsView.vue");
const ProjectView = () => import("./views/ProjectView.vue");
const CategoriesView = () => import("./views/CategoriesView.vue");
const TagsView = () => import("./views/TagsView.vue");
const PeopleView = () => import("./views/PeopleView.vue");
const StatisticsView = () => import("./views/StatisticsView.vue");
const ArchiveView = () => import("./views/ArchiveView.vue");

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/week" },
    { path: "/week", name: "week", component: WeekView },
    { path: "/tasks", name: "tasks", component: TasksView },
    { path: "/templates", name: "templates", component: TemplatesView },
    { path: "/projects", name: "projects", component: ProjectsView },
    { path: "/projects/:id", name: "project", component: ProjectView, props: true },
    { path: "/categories", name: "categories", component: CategoriesView },
    { path: "/tags", name: "tags", component: TagsView },
    { path: "/people", name: "people", component: PeopleView },
    { path: "/stats", name: "stats", component: StatisticsView },
    { path: "/archive", name: "archive", component: ArchiveView },
  ],
});
