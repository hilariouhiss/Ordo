import {
  TextField as KTextField,
} from "@kobalte/core/text-field";
import { splitProps, type ComponentProps } from "solid-js";

const FIELD_CLASS =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-danger data-[invalid]:focus-visible:ring-danger/40 motion-reduce:transition-none";

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
      class={`${FIELD_CLASS} min-h-24 resize-y py-2 ${local.class ?? ""}`}
    />
  );
}

function Label(props: ComponentProps<typeof KTextField.Label>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.Label
      {...rest}
      class={`text-sm font-medium text-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KTextField.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTextField.Description
      {...rest}
      class={`text-xs text-muted-foreground ${local.class ?? ""}`}
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
