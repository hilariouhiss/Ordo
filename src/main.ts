import "./style.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import CaptureView from "./views/CaptureView.vue";

const captureWindow = isTauri() && getCurrentWindow().label === "capture";

if (captureWindow) {
  createApp(CaptureView).mount("#app");
} else {
  createApp(App).use(router).mount("#app");
}
