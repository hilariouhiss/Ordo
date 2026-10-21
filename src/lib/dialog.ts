import { ref } from "vue";

export type DialogRequest =
  | { kind: "text"; title: string; value: string }
  | { kind: "confirm"; title: string; message: string };

export const dialogRequest = ref<DialogRequest | null>(null);

let settle: ((answer: string | null) => void) | null = null;

function ask(request: DialogRequest): Promise<string | null> {
  dialogRequest.value = request;
  return new Promise((resolve) => {
    settle = resolve;
  });
}

export function closeDialog(answer: string | null): void {
  dialogRequest.value = null;
  settle?.(answer);
  settle = null;
}

export function askText(title: string, value: string): Promise<string | null> {
  return ask({ kind: "text", title, value });
}

export function askConfirm(title: string, message: string): Promise<boolean> {
  return ask({ kind: "confirm", title, message }).then((answer) => answer !== null);
}
