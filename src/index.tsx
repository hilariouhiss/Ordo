/* @refresh reload */
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RouterProvider } from "@tanstack/solid-router";
import QuickAddWindow from "./app/QuickAddWindow";
import { router } from "./router";
// Applies the active theme (light/dark/system) to the document.
import "./common/stores/ui";
import "./index.css";

/**
 * Both of the app's windows load this same page (D-02): the main one runs the
 * router, and the small `quick-add` one is the capture field. The window
 * label is what tells them apart.
 *
 * Outside a Tauri runtime — the plain Vite dev server — there is no label to
 * read, and the main app is the only sensible thing to render.
 */
function isQuickAddWindow(): boolean {
  try {
    return getCurrentWindow().label === "quick-add";
  } catch {
    return false;
  }
}

render(
  () => (
    <Show when={isQuickAddWindow()} fallback={<RouterProvider router={router} />}>
      <QuickAddWindow />
    </Show>
  ),
  document.getElementById("root") as HTMLElement,
);
