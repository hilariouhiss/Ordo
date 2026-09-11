import { Show, createSignal } from "solid-js";
import { format } from "date-fns";
import { Download, Upload } from "lucide-solid";
import { Button, Dialog } from "../../../common/components";
import { pickBackupFile, pickExportPath, runExport, runImport } from "../hooks";
import type { BackupSummary } from "../types";

const PANEL_CLASS = "rounded-lg border border-border bg-surface p-4";

function stamp(summary: BackupSummary): string {
  return format(new Date(summary.exportedAt), "yyyy-MM-dd HH:mm");
}

/**
 * `/settings` (D-03): the manual backup entry. Export writes the whole
 * database to a JSON file chosen in the OS save dialog; restore reads one back
 * and replaces everything, so it asks for confirmation first — that dialog is
 * the only place stating how destructive it is.
 */
export function SettingsView() {
  const [exported, setExported] = createSignal<BackupSummary | null>(null);
  const [restored, setRestored] = createSignal<BackupSummary | null>(null);
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function exportNow(): Promise<void> {
    const path = await pickExportPath();
    if (!path) return;
    setBusy(true);
    const summary = await runExport(path);
    setBusy(false);
    if (summary) setExported(summary);
  }

  async function chooseBackup(): Promise<void> {
    const path = await pickBackupFile();
    if (path) setPendingPath(path);
  }

  async function confirmRestore(): Promise<void> {
    const path = pendingPath();
    setPendingPath(null);
    if (!path) return;
    setBusy(true);
    const summary = await runImport(path);
    setBusy(false);
    if (summary) setRestored(summary);
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-b border-border px-6 py-3">
        <h1 class="text-sm font-medium text-foreground">设置</h1>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <section aria-label="数据备份" class={`${PANEL_CLASS} max-w-2xl`}>
          <h2 class="text-sm font-medium text-foreground">数据备份</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            把项目、任务、标签、看板列、评论、时间记录与设置导出为一个 JSON
            文件；恢复会覆盖当前全部数据，无法撤销。
          </p>

          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy()}
              onClick={() => void exportNow()}
            >
              <Download size={14} aria-hidden="true" />
              导出备份
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-danger hover:bg-danger/10"
              disabled={busy()}
              onClick={() => void chooseBackup()}
            >
              <Upload size={14} aria-hidden="true" />
              从备份恢复
            </Button>
          </div>

          <Show when={exported()}>
            {(summary) => (
              <p role="status" class="mt-3 break-all text-xs text-muted-foreground">
                已导出 {summary().counts.tasks} 个任务（{stamp(summary())}）：{summary().path}
              </p>
            )}
          </Show>
          <Show when={restored()}>
            {(summary) => (
              <p role="status" class="mt-3 break-all text-xs text-muted-foreground">
                已从备份恢复 {summary().counts.tasks} 个任务、{summary().counts.projects} 个项目（
                {stamp(summary())}）：{summary().path}
              </p>
            )}
          </Show>
        </section>
      </div>

      <Dialog.Root
        open={pendingPath() !== null}
        onOpenChange={(open) => setPendingPath(open ? pendingPath() : null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content aria-labelledby="restore-title">
            <Dialog.Title id="restore-title">从备份恢复</Dialog.Title>
            <Dialog.Description>
              这会用备份文件覆盖当前全部项目、任务、标签、看板列、评论、时间记录与设置，且无法撤销。
            </Dialog.Description>
            <p class="mt-3 break-all rounded-md bg-surface-hover px-3 py-2 text-xs text-muted-foreground">
              {pendingPath()}
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingPath(null)}>
                取消
              </Button>
              <Button variant="destructive" onClick={() => void confirmRestore()}>
                确认恢复
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
