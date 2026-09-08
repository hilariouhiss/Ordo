/* @refresh reload */
import { render } from "solid-js/web";
import { RouterProvider } from "@tanstack/solid-router";
import { router } from "./router";
// Applies the active theme (light/dark/system) to the document.
import "./common/stores/ui";
import "./index.css";

render(() => <RouterProvider router={router} />, document.getElementById("root") as HTMLElement);
