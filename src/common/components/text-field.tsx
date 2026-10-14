import { TextField as KTextField } from "@kobalte/core/text-field";
import { splitProps, type ComponentProps } from "solid-js";

/*
 * One field recipe shared by `<input>`, `<textarea>` and the date/number
 * variants. `input-sm` is exactly `h-8` (daisyUI sizes a field as
 * `--size-field * 8`), which matches the buttons and select triggers it sits
 * beside, so a toolbar of mixed controls lines up on one optical baseline.
 * The border, fill and inset are overridden back to the app's pair
 * (`border-border` / `bg-base-200`, 10px) so the field keeps its look.
 */
const FIELD_CLASS =
  "input input-sm w-full border-border bg-base-200 px-2.5 text-sm text-base-content transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-error data-[invalid]:hover:border-error focus-ring";

function Root(props: ComponentProps<typeof KTextField>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTextField {...rest} class={`flex flex-col gap-1.5 ${local.class ?? ""}`} />;
}

function Input(props: ComponentProps<typeof KTextField.Input>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTextField.Input {...rest} class={`${FIELD_CLASS} ${local.class ?? ""}`} />;
}

function TextArea(props: ComponentProps<typeof KTextField.TextArea>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.TextArea
      {...rest}
      class={`${FIELD_CLASS} h-auto min-h-20 resize-y py-2 leading-relaxed ${local.class ?? ""}`}
    />
  );
}

function Label(props: ComponentProps<typeof KTextField.Label>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.Label
      {...rest}
      class={`text-xs font-medium text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KTextField.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.Description
      {...rest}
      class={`text-xs text-subtle-foreground ${local.class ?? ""}`}
    />
  );
}

function ErrorMessage(props: ComponentProps<typeof KTextField.ErrorMessage>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.ErrorMessage
      {...rest}
      class={`text-xs font-medium text-error ${local.class ?? ""}`}
    />
  );
}

export const TextField = { Root, Input, TextArea, Label, Description, ErrorMessage };
