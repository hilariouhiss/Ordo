import { reactive, watchEffect } from "vue";

/** What the shell's 56px title row shows; each page sets it from its own view model. */
export interface PageHeader {
  title: string;
  context?: string;
  /** A red tail after the context, for the one number that needs attention. */
  warning?: string;
  actionLabel?: string;
  actionCount?: number | null;
  action?: (() => void) | null;
}

export const pageHeaderState = reactive<Required<PageHeader>>({
  title: "",
  context: "",
  warning: "",
  actionLabel: "",
  actionCount: null,
  action: null,
});

function apply(next: PageHeader): void {
  const current = pageHeaderState;
  if (
    current.title === next.title &&
    current.context === (next.context ?? "") &&
    current.warning === (next.warning ?? "") &&
    current.actionLabel === (next.actionLabel ?? "") &&
    current.actionCount === (next.actionCount ?? null) &&
    current.action === (next.action ?? null)
  )
    return;
  current.title = next.title;
  current.context = next.context ?? "";
  current.warning = next.warning ?? "";
  current.actionLabel = next.actionLabel ?? "";
  current.actionCount = next.actionCount ?? null;
  current.action = next.action ?? null;
}

/** Pages call this once in setup; the getter keeps the context live as the data changes. */
export function usePageHeader(source: () => PageHeader): void {
  watchEffect(() => apply(source()));
}
