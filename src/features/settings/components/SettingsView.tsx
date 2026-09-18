import { Show, createSignal, onMount } from "solid-js";
import { format } from "date-fns";
import { Download, Upload } from "lucide-solid";
import { Button, Checkbox, Dialog } from "../../../common/components";
import {
  loadAutostart,
  pickBackupFile,
  pickExportPath,
  runExport,
  runImport,
  setAutostart,
} from "../hooks";
import type { BackupSummary } from "../types";

const PANEL_CLASS = "rounded-xl bg-surface p-5 shadow-sm";

function stamp(summary: BackupSummary): string {
  return format(new Date(summary.exportedAt), "yyyy-MM-dd HH:mm");
}

/**
 * `/settings`: the manual backup entry (D-03) and the startup switch (D-04).
 *
 * Export writes the whole database to a JSON file chosen in the OS save dialog;
 * restore reads one back and replaces everything, so it asks for confirmation
 * first — that dialog is the only place stating how destructive it is.
 *
 * The startup switch reads the OS login items on mount, so it shows what the
 * system actually does rather than what we last wrote; nothing turns it on by
 * itself, which is what keeps startup off by default.
 */
export function SettingsView() {
  const [exported, setExported] = createSignal<BackupSummary | null>(null);
  const [restored, setRestored] = createSignal<BackupSummary | null>(null);
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  const [autostart, setAutostartOn] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    void loadAutostart().then(setAutostartOn);
  });

  async function toggleAutostart(enabled: boolean): Promise<void> {
    setBusy(true);
    const applied = await setAutostart(enabled);
    setBusy(false);
    if (applied !== null) setAutostartOn(applied);
  }

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
      <div class="flex h-12 shrink-0 items-center border-b border-border px-5">
        <h1 class="text-base font-semibold tracking-tight">设置</h1>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section aria-label="数据备份" class={`${PANEL_CLASS} max-w-2xl`}>
          <h2 class="text-sm font-semibold tracking-tight text-foreground">数据备份</h2>
          <p class="mt-1.5 text-sm text-muted-foreground">
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
              variant="destructive-ghost"
              size="sm"
              disabled={busy()}
              onClick={() => void chooseBackup()}
            >
              <Upload size={14} aria-hidden="true" />
              从备份恢复
            </Button>
          </div>

          {/* Neither summary is a live region: the toast for the same event
              already announces it, and two polite regions for one action read
              the message out twice. These are the record left on screen. */}
          <Show when={exported()}>
            {(summary) => (
              <p class="mt-3 break-all rounded-md bg-sunken px-3 py-2 text-xs text-muted-foreground">
                已导出 {summary().counts.tasks} 个任务（{stamp(summary())}）：{summary().path}
              </p>
            )}
          </Show>
          <Show when={restored()}>
            {(summary) => (
              <p class="mt-3 break-all rounded-md bg-sunken px-3 py-2 text-xs text-muted-foreground">
                已从备份恢复 {summary().counts.tasks} 个任务、{summary().counts.projects} 个项目、
                {summary().counts.namespaces} 个命名空间（
                {stamp(summary())}）：{summary().path}
              </p>
            )}
          </Show>
        </section>

        <section aria-label="启动" class={`${PANEL_CLASS} mt-5 max-w-2xl`}>
          <h2 class="text-sm font-semibold tracking-tight text-foreground">启动</h2>
          <p class="mt-1.5 text-sm text-muted-foreground">
            随系统登录启动 Ordo，默认关闭。启动后应用驻留托盘，关闭主窗口不会退出。
          </p>
          <Checkbox.Root
            class="mt-3"
            checked={autostart()}
            disabled={busy()}
            onChange={(checked) => void toggleAutostart(checked)}
          >
            <Checkbox.Input />
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Label>开机自启</Checkbox.Label>
          </Checkbox.Root>
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
            <p class="mt-3 min-h-0 flex-1 overflow-y-auto break-all rounded-md bg-sunken px-3 py-2 text-xs text-muted-foreground">
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
