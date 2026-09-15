import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  redirect,
} from "@tanstack/solid-router";
import AppShell from "./app/AppShell";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <div class="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 class="text-2xl font-semibold text-foreground">页面不存在</h1>
      <p class="text-sm text-muted-foreground">你访问的页面不存在或已被移除。</p>
      <Link
        to="/today"
        class="mt-1 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
      >
        返回今天
      </Link>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/today" });
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: lazyRouteComponent(
    () => import("./features/tasks/components/views/InboxView"),
    "InboxView",
  ),
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/today",
  component: lazyRouteComponent(
    () => import("./features/tasks/components/views/TodayView"),
    "TodayView",
  ),
});

const upcomingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/upcoming",
  component: lazyRouteComponent(
    () => import("./features/tasks/components/views/UpcomingView"),
    "UpcomingView",
  ),
});

const completedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/completed",
  component: lazyRouteComponent(
    () => import("./features/tasks/components/views/CompletedView"),
    "CompletedView",
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: lazyRouteComponent(
    () => import("./features/projects/components/ProjectDetailView"),
    "ProjectDetailView",
  ),
});

const namespaceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/namespaces/$namespaceId",
  component: lazyRouteComponent(
    () => import("./features/namespaces/components/NamespaceDetailView"),
    "NamespaceDetailView",
  ),
});

const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: lazyRouteComponent(
    () => import("./features/stats/components/StatsView"),
    "StatsView",
  ),
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: lazyRouteComponent(
    () => import("./features/search/components/SearchView"),
    "SearchView",
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("./features/settings/components/SettingsView"),
    "SettingsView",
  ),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  todayRoute,
  upcomingRoute,
  completedRoute,
  projectDetailRoute,
  namespaceDetailRoute,
  statsRoute,
  searchRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/solid-router" {
  interface Register {
    router: typeof router;
  }
}
