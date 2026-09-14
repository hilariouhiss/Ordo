import { TextField as KTextField } from "@kobalte/core/text-field";
import { splitProps, type ComponentProps } from "solid-js";

/*
 * One field recipe shared by `<input>`, `<textarea>` and the date/number
 * variants. `h-8` matches the buttons and select triggers it sits beside, so
 * a toolbar of mixed controls lines up on one optical baseline.
 */
const FIELD_CLASS =
  "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-danger data-[invalid]:hover:border-danger focus-ring";

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
      class={`text-xs font-medium text-danger ${local.class ?? ""}`}
    />
  );
}

export const TextField = { Root, Input, TextArea, Label, Description, ErrorMessage };
