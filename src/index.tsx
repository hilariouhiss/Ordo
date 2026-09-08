/* @refresh reload */
import { render } from "solid-js/web";
import { RouterProvider } from "@tanstack/solid-router";
import { router } from "./router";
import "./index.css";

render(() => <RouterProvider router={router} />, document.getElementById("root") as HTMLElement);
