import "./style.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createApp } from "vue";
import { setLanguage } from "./lib/i18n";
import { getSettings } from "./model/ipc";
import App from "./App.vue";
import { router } from "./router";
import CaptureView from "./views/CaptureView.vue";

// Read the language before the first paint: the Rust side resolves an unset
// preference to the OS UI language, so English systems no longer flash Chinese.
if (isTauri()) {
  try {
    const { language } = await getSettings();
    if (language === "zh" || language === "en") setLanguage(language);
  } catch {
    // The app applies the setting after mounting if this early read fails.
  }
} else {
  setLanguage(navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
}

const captureWindow = isTauri() && getCurrentWindow().label === "capture";

if (captureWindow) {
  createApp(CaptureView).mount("#app");
} else {
  createApp(App).use(router).mount("#app");
}
