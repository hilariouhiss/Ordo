import { ref } from "vue";

export interface SuspendDraft {
  reason: string;
  until: string;
}

export type DialogRequest =
  | { kind: "text"; title: string; value: string }
  | { kind: "suspend"; title: string }
  | { kind: "confirm"; title: string; message: string }
  | { kind: "notice"; title: string; message: string };

export const dialogRequest = ref<DialogRequest | null>(null);

let settle: ((answer: string | SuspendDraft | null) => void) | null = null;

function ask(request: DialogRequest): Promise<string | SuspendDraft | null> {
  dialogRequest.value = request;
  return new Promise((resolve) => {
    settle = resolve;
  });
}

export function closeDialog(answer: string | SuspendDraft | null): void {
  dialogRequest.value = null;
  settle?.(answer);
  settle = null;
}

export function askText(title: string, value: string): Promise<string | null> {
  return ask({ kind: "text", title, value }) as Promise<string | null>;
}

export function askSuspend(title: string): Promise<SuspendDraft | null> {
  return ask({ kind: "suspend", title }) as Promise<SuspendDraft | null>;
}

export function askConfirm(title: string, message: string): Promise<boolean> {
  return ask({ kind: "confirm", title, message }).then((answer) => answer !== null);
}

/** A one-button message; the answer carries no meaning. */
export function askNotice(title: string, message: string): Promise<void> {
  return ask({ kind: "notice", title, message }).then(() => undefined);
}
