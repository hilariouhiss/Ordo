import { For, Show, createEffect, createSignal, on } from "solid-js";
import { Check } from "lucide-solid";
import { z } from "zod";
import { Button, Dialog, TextField } from "../../../common/components";
import { isoToLocalDateValue, localDateValueToIso } from "../../../common/utils/datetime";
import { createProject, updateProject } from "../hooks";
import { PROJECT_ICON_NAMES, getProjectIcon } from "../icons";
import type { Project } from "../types";

/**
 * Create/edit project dialog (P-03). One component covers both modes: pass
 * `project` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the
 * form open and surface a notification (handled by the hooks).
 */

/** Preset palette (PRD: projects carry an optional colour); `null` = no colour. */
export const PROJECT_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#78716c",
] as const;

const formSchema = z.object({
  name: z.string().trim().min(1, "项目名不能为空"),
  dueLocal: z
    .string()
    .refine(
      (value) => value === "" || !Number.isNaN(new Date(`${value}T23:59:59`).getTime()),
      "截止日期无效",
    ),
});

type FormField = "name" | "dueLocal";

/*
 * `size-7`, not the old 24px dot: a colour swatch is a click target, and at
 * 24px a ten-colour grid becomes a pixel hunt. Square, so it sits in the same
 * geometric family as the buttons under it. The border colour comes from the
 * class rather than an inline style, so `hover:border-border-strong` can
 * actually win.
 */
const SWATCH_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-border transition focus-ring hover:border-border-strong active:scale-90";

export interface ProjectEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project to edit; omit to create a new one. */
  project?: Project;
}

export function ProjectEditorDialog(props: ProjectEditorDialogProps) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [color, setColor] = createSignal<string | null>(null);
  const [icon, setIcon] = createSignal<string | null>(null);
  const [dueLocal, setDueLocal] = createSignal("");
  const [errors, setErrors] = createSignal<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = createSignal(false);

  // Re-seed the form whenever the dialog (re)opens or switches project.
  createEffect(
    on(
      () => [props.open, props.project] as const,
      ([open, project]) => {
        if (!open) return;
        setName(project?.name ?? "");
        setDescription(project?.description ?? "");
        setColor(project?.color ?? null);
        setIcon(project?.icon ?? null);
        setDueLocal(isoToLocalDateValue(project?.dueAt ?? null));
        setErrors({});
        setSubmitting(false);
      },
    ),
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = formSchema.safeParse({ name: name(), dueLocal: dueLocal() });
    if (!parsed.success) {
      const next: Partial<Record<FormField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FormField;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const descriptionValue = description().trim() ? description().trim() : null;
      const payload = {
        name: parsed.data.name,
        description: descriptionValue,
        color: color(),
        icon: icon(),
        dueAt: localDateValueToIso(parsed.data.dueLocal),
      };
      const result = props.project
        ? await updateProject(props.project.id, payload)
        : await createProject(payload);
      if (result) props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-labelledby="project-editor-title">
          <Dialog.Title id="project-editor-title">
            {props.project ? "编辑项目" : "新建项目"}
          </Dialog.Title>
          <Dialog.Description>
            {props.project ? "修改项目内容后保存" : "填写项目内容，名称必填"}
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form class="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <TextField.Root
              value={name()}
              onChange={(value) => {
                setName(value);
                if (errors().name) setErrors({ ...errors(), name: undefined });
              }}
              validationState={errors().name ? "invalid" : "valid"}
            >
              <TextField.Label>名称</TextField.Label>
              <TextField.Input placeholder="例如：网站改版" />
              <TextField.ErrorMessage>{errors().name ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <TextField.Root value={description()} onChange={setDescription}>
              <TextField.Label>描述</TextField.Label>
              <TextField.TextArea placeholder="项目目标与背景（可选）" />
            </TextField.Root>

            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-muted-foreground">颜色</span>
              <div role="group" aria-label="项目颜色" class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-label="无颜色"
                  aria-pressed={color() === null}
                  class={`${SWATCH_CLASS} bg-surface text-2xs text-muted-foreground`}
                  classList={{ "ring-2 ring-ring": color() === null }}
                  onClick={() => setColor(null)}
                >
                  无
                </button>
                <For each={PROJECT_COLORS}>
                  {(swatch) => (
                    <button
                      type="button"
                      aria-label={`颜色 ${swatch}`}
                      aria-pressed={color() === swatch}
                      class={SWATCH_CLASS}
                      classList={{ "ring-2 ring-ring": color() === swatch }}
                      style={{ "background-color": swatch }}
                      onClick={() => setColor(swatch)}
                    >
                      <Show when={color() === swatch}>
                        <Check size={13} class="text-white mix-blend-difference" aria-hidden="true" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-muted-foreground">图标</span>
              <div role="group" aria-label="项目图标" class="flex flex-wrap items-center gap-1.5">
                <For each={PROJECT_ICON_NAMES}>
                  {(iconName) => {
                    const Icon = getProjectIcon(iconName);
                    return (
                      <button
                        type="button"
                        aria-label={`图标 ${iconName}`}
                        aria-pressed={icon() === iconName}
                        class="inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition duration-150 ease-out hover:border-border-strong hover:bg-surface-hover active:scale-90 focus-ring"
                        classList={{
                          "border-primary bg-primary/10 text-primary":
                            icon() === iconName,
                        }}
                        onClick={() => setIcon(iconName)}
                      >
                        <Icon size={15} />
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            <TextField.Root
              value={dueLocal()}
              onChange={(value) => {
                setDueLocal(value);
                if (errors().dueLocal) setErrors({ ...errors(), dueLocal: undefined });
              }}
              validationState={errors().dueLocal ? "invalid" : "valid"}
            >
              <TextField.Label>截止日期</TextField.Label>
              <TextField.Input type="date" />
              <TextField.ErrorMessage>{errors().dueLocal ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <div class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting()}>
                {props.project ? "保存" : "创建"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
