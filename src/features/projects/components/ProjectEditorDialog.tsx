import { Show, createEffect, createSignal, on } from "solid-js";
import { z } from "zod";
import {
  Button,
  ColorSwatches,
  Dialog,
  IconPicker,
  Select,
  TextField,
} from "../../../common/components";
import { isoToLocalDateValue, localDateValueToIso } from "../../../common/utils/datetime";
import { randomColor } from "../../../common/colors";
import { createNamespace } from "../../namespaces/hooks";
import { activeNamespaces, getNamespace } from "../../namespaces/store";
import type { Namespace } from "../../namespaces/types";
import { createProject, updateProject } from "../hooks";
import type { Project } from "../types";

/**
 * Create/edit project dialog (P-03). One component covers both modes: pass
 * `project` to edit it, omit it to create a new one. Submits through the
 * optimistic hooks; the dialog closes only on success — failures keep the
 * form open and surface a notification (handled by the hooks).
 */

const formSchema = z.object({
  name: z.string().trim().min(1, "项目名不能为空"),
  dueLocal: z
    .string()
    .refine(
      (value) => value === "" || !Number.isNaN(new Date(`${value}T23:59:59`).getTime()),
      "截止日期无效",
    ),
});

type FormField = "name" | "dueLocal" | "namespaceName";

/** Sentinel for "no namespace": a real string, never `""`. */
const NOT_FILED = "none";

/** Sentinel for the "create one right here" option (R5). */
const NEW_NAMESPACE = "__new__";

type NamespaceOption = { id: string | null; name: string };

export interface ProjectEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project to edit; omit to create a new one. */
  project?: Project;
  /** Namespace preselected for a new project (ignored when editing). */
  defaultNamespaceId?: string | null;
}

export function ProjectEditorDialog(props: ProjectEditorDialogProps) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [color, setColor] = createSignal<string | null>(null);
  const [icon, setIcon] = createSignal<string | null>(null);
  const [namespaceId, setNamespaceId] = createSignal<string | null>(null);
  /** Name typed for the inline 新建命名空间 option (R5). */
  const [newNamespaceName, setNewNamespaceName] = createSignal("");
  const [dueLocal, setDueLocal] = createSignal("");
  const [errors, setErrors] = createSignal<Partial<Record<FormField, string>>>({});
  const [submitting, setSubmitting] = createSignal(false);

  /** Whether the Select currently points at "create a namespace here". */
  const creatingNamespace = () => namespaceId() === NEW_NAMESPACE;

  // The namespace this dialog will submit: the edited project's own, or the
  // preset for a new one. It mirrors the re-seed below on purpose — one
  // definition, so the option list can never disagree with the payload.
  const currentId = (): string | null =>
    props.project ? props.project.namespaceId : (props.defaultNamespaceId ?? null);

  // Whatever `currentId()` points at stays in the list even when the navigation
  // does not offer it: an archived namespace (shown as "…（已归档）") or one that
  // no longer resolves at all ("未知命名空间"). Leaving it out would make the
  // Select fall back to "不归属" — the trigger would then show one value while
  // the payload keeps another, and the next save would silently unfile the
  // project.
  const namespaceOptions = (): NamespaceOption[] => {
    const id = currentId();
    const current = id ? getNamespace(id) : undefined;
    const archived: NamespaceOption[] =
      current?.status === "archived"
        ? [{ id: current.id, name: `${current.name}（已归档）` }]
        : [];
    const unresolved: NamespaceOption[] =
      id && !current ? [{ id, name: "未知命名空间" }] : [];
    return [
      { id: null, name: "不归属" },
      ...archived,
      ...unresolved,
      ...activeNamespaces().map((namespace: Namespace) => ({
        id: namespace.id,
        name: namespace.name,
      })),
      { id: NEW_NAMESPACE, name: "＋ 新建命名空间…" },
    ];
  };

  const selectedNamespace = (): NamespaceOption =>
    namespaceOptions().find((option) => option.id === namespaceId()) ?? namespaceOptions()[0];

  // Re-seed the form whenever the dialog (re)opens or switches project.
  createEffect(
    on(
      () => [props.open, props.project] as const,
      ([open, project]) => {
        if (!open) return;
        setName(project?.name ?? "");
        setDescription(project?.description ?? "");
        setColor(project ? project.color : randomColor());
        setIcon(project?.icon ?? null);
        setNamespaceId(project ? project.namespaceId : (props.defaultNamespaceId ?? null));
        setNewNamespaceName("");
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
    if (creatingNamespace() && !newNamespaceName().trim()) {
      setErrors({ namespaceName: "命名空间名不能为空" });
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      // R5: 选了「＋ 新建命名空间…」就先建命名空间。建好立刻把它选成当前值，
      // 于是重试只会重发项目那一步，不会重复建命名空间；失败时表单留在原地。
      let targetNamespaceId = namespaceId() === NEW_NAMESPACE ? null : namespaceId();
      if (creatingNamespace()) {
        const created = await createNamespace({ name: newNamespaceName().trim() });
        if (!created) return;
        targetNamespaceId = created.id;
        setNamespaceId(created.id);
      }

      const descriptionValue = description().trim() ? description().trim() : null;
      const payload = {
        name: parsed.data.name,
        description: descriptionValue,
        color: color(),
        icon: icon(),
        namespaceId: targetNamespaceId,
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

            <ColorSwatches value={color()} onChange={setColor} label="项目颜色" />
            <IconPicker value={icon()} onChange={setIcon} label="项目图标" />

            <Select.Root
              options={namespaceOptions()}
              optionValue={(option) => option.id ?? NOT_FILED}
              optionTextValue={(option) => option.name}
              itemToString={(option) => option.name}
              value={selectedNamespace()}
              onChange={(option) => {
                const id = option?.id ?? null;
                // Kobalte fires this once on mount with the initial value, so
                // only a real change counts as a pick — same guard as the
                // quick-add window's selects.
                if (id === namespaceId()) return;
                setNamespaceId(id);
              }}
            >
              <Select.Label>命名空间</Select.Label>
              <Select.Trigger>
                <Select.Value>{selectedNamespace().name}</Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content>
                <Select.Listbox />
              </Select.Content>
            </Select.Root>

            {/* R5: 就地给新命名空间起名，提交时先建它再建项目。 */}
            <Show when={creatingNamespace()}>
              <TextField.Root
                value={newNamespaceName()}
                onChange={(value) => {
                  setNewNamespaceName(value);
                  if (errors().namespaceName) setErrors({ ...errors(), namespaceName: undefined });
                }}
                validationState={errors().namespaceName ? "invalid" : "valid"}
              >
                <TextField.Label>命名空间名称</TextField.Label>
                <TextField.Input placeholder="例如：工作" />
                <TextField.ErrorMessage>{errors().namespaceName ?? ""}</TextField.ErrorMessage>
              </TextField.Root>
            </Show>

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
