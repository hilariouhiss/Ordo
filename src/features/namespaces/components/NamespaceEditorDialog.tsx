import { createEffect, createSignal, on } from "solid-js";
import { z } from "zod";
import {
  Button,
  ColorSwatches,
  Dialog,
  IconPicker,
  TextField,
} from "../../../common/components";
import { randomColor } from "../../../common/colors";
import { createNamespace, updateNamespace } from "../hooks";
import type { Namespace } from "../types";

/**
 * Create/edit namespace dialog. One component covers both modes: pass
 * `namespace` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the form
 * open and surface a notification (handled by the hooks).
 */

const formSchema = z.object({
  name: z.string().trim().min(1, "命名空间名不能为空"),
});

export interface NamespaceEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Namespace to edit; omit to create a new one. */
  namespace?: Namespace;
}

export function NamespaceEditorDialog(props: NamespaceEditorDialogProps) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [color, setColor] = createSignal<string | null>(null);
  const [icon, setIcon] = createSignal<string | null>(null);
  const [nameError, setNameError] = createSignal<string | undefined>(undefined);
  const [submitting, setSubmitting] = createSignal(false);

  // Re-seed the form whenever the dialog (re)opens or switches namespace.
  createEffect(
    on(
      () => [props.open, props.namespace] as const,
      ([open, namespace]) => {
        if (!open) return;
        setName(namespace?.name ?? "");
        setDescription(namespace?.description ?? "");
        setColor(namespace ? namespace.color : randomColor());
        setIcon(namespace?.icon ?? null);
        setNameError(undefined);
        setSubmitting(false);
      },
    ),
  );

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = formSchema.safeParse({ name: name() });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message);
      return;
    }

    setNameError(undefined);
    setSubmitting(true);
    try {
      const payload = {
        name: parsed.data.name,
        description: description().trim() ? description().trim() : null,
        color: color(),
        icon: icon(),
      };
      const result = props.namespace
        ? await updateNamespace(props.namespace.id, payload)
        : await createNamespace(payload);
      if (result) props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-labelledby="namespace-editor-title">
          <Dialog.Title id="namespace-editor-title">
            {props.namespace ? "编辑命名空间" : "新建命名空间"}
          </Dialog.Title>
          <Dialog.Description>
            {props.namespace ? "修改命名空间内容后保存" : "命名空间把相关项目收在一起，名称必填"}
          </Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <form
            class="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
            onSubmit={handleSubmit}
          >
            <TextField.Root
              value={name()}
              onChange={(value) => {
                setName(value);
                if (nameError()) setNameError(undefined);
              }}
              validationState={nameError() ? "invalid" : "valid"}
            >
              <TextField.Label>名称</TextField.Label>
              <TextField.Input placeholder="例如：工作" />
              <TextField.ErrorMessage>{nameError() ?? ""}</TextField.ErrorMessage>
            </TextField.Root>

            <TextField.Root value={description()} onChange={setDescription}>
              <TextField.Label>描述</TextField.Label>
              <TextField.TextArea placeholder="这组项目的共同点（可选）" />
            </TextField.Root>

            <ColorSwatches value={color()} onChange={setColor} label="命名空间颜色" />
            <IconPicker value={icon()} onChange={setIcon} label="命名空间图标" />

            <div class="mt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={submitting()}>
                {props.namespace ? "保存" : "创建"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
