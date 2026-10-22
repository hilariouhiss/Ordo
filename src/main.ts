import "./style.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createApp } from "vue";
import { setLanguage, type Language } from "./lib/i18n";
import { applyTheme, resolveTheme, systemPrefersDark } from "./lib/theme";
import { getSettings } from "./model/ipc";
import App from "./App.vue";
import { router } from "./router";
import CaptureView from "./views/CaptureView.vue";

// Language and theme are read before the first paint: the Rust side resolves an unset
// preference to the OS, so English/dark systems no longer flash the defaults.
let language: Language = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
let theme = "system";
if (isTauri()) {
  try {
    const settings = await getSettings();
    if (settings.language === "zh" || settings.language === "en") language = settings.language;
    theme = settings.theme;
  } catch {
    // The app applies the setting after mounting if this early read fails.
  }
}
setLanguage(language);
applyTheme(resolveTheme(theme, systemPrefersDark()));

const captureWindow = isTauri() && getCurrentWindow().label === "capture";

if (captureWindow) {
  createApp(CaptureView).mount("#app");
} else {
  const app = createApp(App).use(router);
  // Wait for the initial route so the first painted frame is the page, not the redirect.
  await router.isReady();
  app.mount("#app");
}
