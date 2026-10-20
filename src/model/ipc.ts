import { invoke } from "@tauri-apps/api/core";
import type { Bootstrap } from "./types";

export function bootstrap(): Promise<Bootstrap> {
  return invoke<Bootstrap>("bootstrap");
}
