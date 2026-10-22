import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ref } from "vue";

/** Height the capture window must grow to while an anchored popup is open. */
export const miniPopupHeight = ref(0);

export function isCaptureWindow(): boolean {
  return isTauri() && getCurrentWindow().label === "capture";
}
