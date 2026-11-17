import { ref } from "vue";
import type { OverdueTask } from "../model/types";
import { errorText, t } from "./i18n";

export interface SuspendDraft {
  reason: string;
  until: string;
}

export interface WaitingDraft {
  personId: string | null;
  followUpDate: string;
}

/** A delay: the new finish day plus why it moved. */
export interface DeferDraft {
  finish: string;
  reason: string;
}

/** One row of the overdue summary: the task and the day it moves to. */
export interface OverdueDeferDraft {
  dates: { id: string; finish: string }[];
  reason: string;
}

/** The person record a dialog edits: name plus the categories they are responsible for. */
export interface PersonDraft {
  name: string;
  categoryIds: string[];
}

/** The 甲方 record a dialog edits: the page turns blank details into null. */
export interface ClientDraft {
  name: string;
  contact: string;
  phone: string;
  note: string;
}

export type DialogRequest =
  | { kind: "text"; title: string; value: string }
  | { kind: "suspend"; title: string }
  | { kind: "waiting"; title: string; personId: string | null; followUpDate: string }
  | {
      kind: "defer";
      title: string;
      finish: string;
      min: string;
      oldFinish: string;
    }
  | { kind: "overdue"; title: string; tasks: OverdueTask[]; finish: string; min: string }
  | ({ kind: "client"; title: string } & ClientDraft)
  | ({ kind: "person"; title: string } & PersonDraft)
  | { kind: "confirm"; title: string; message: string }
  | { kind: "notice"; title: string; message: string }
  | { kind: "noticeOptOut"; title: string; message: string; label: string; checked: boolean };

export const dialogRequest = ref<DialogRequest | null>(null);

type DialogAnswer =
  | boolean
  | string
  | SuspendDraft
  | WaitingDraft
  | DeferDraft
  | OverdueDeferDraft
  | ClientDraft
  | PersonDraft
  | null;

let settle: ((answer: DialogAnswer) => void) | null = null;

function ask(request: DialogRequest): Promise<DialogAnswer> {
  // A second request must not overwrite the first resolver: that promise would never settle.
  closeDialog(null);
  dialogRequest.value = request;
  return new Promise((resolve) => {
    settle = resolve;
  });
}

export function closeDialog(answer: DialogAnswer): void {
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

export function askWaiting(title: string, defaults: WaitingDraft): Promise<WaitingDraft | null> {
  return ask({ kind: "waiting", title, ...defaults }) as Promise<WaitingDraft | null>;
}

export function askDefer(
  title: string,
  defaults: { finish: string; min: string; oldFinish: string },
): Promise<DeferDraft | null> {
  return ask({ kind: "defer", title, ...defaults }) as Promise<DeferDraft | null>;
}

/** The overdue summary: one dialog for every task, each row picking its own day. */
export function askOverdueDefer(
  title: string,
  tasks: OverdueTask[],
  defaults: { finish: string; min: string },
): Promise<OverdueDeferDraft | null> {
  return ask({ kind: "overdue", title, tasks, ...defaults }) as Promise<OverdueDeferDraft | null>;
}

export function askClient(title: string, defaults: ClientDraft): Promise<ClientDraft | null> {
  return ask({ kind: "client", title, ...defaults }) as Promise<ClientDraft | null>;
}

export function askPerson(title: string, defaults: PersonDraft): Promise<PersonDraft | null> {
  return ask({ kind: "person", title, ...defaults }) as Promise<PersonDraft | null>;
}

export function askConfirm(title: string, message: string): Promise<boolean> {
  return ask({ kind: "confirm", title, message }).then((answer) => answer !== null);
}

/** A one-button message; the answer carries no meaning. */
export function askNotice(title: string, message: string): Promise<void> {
  return ask({ kind: "notice", title, message }).then(() => undefined);
}

/** A one-button message with a "don't show again" checkbox; the answer is the checkbox. */
export function askNoticeOptOut(
  title: string,
  message: string,
  label: string,
  checked: boolean,
): Promise<boolean> {
  return ask({ kind: "noticeOptOut", title, message, label, checked }).then(
    (answer) => answer === true,
  );
}

/** Runs a user action and reports a rejection instead of leaving it unhandled. */
export async function runWithNotice(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
    return false;
  }
}
