import {
  Checkbox as KCheckbox,
} from "@kobalte/core/checkbox";
import { Check } from "lucide-solid";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KCheckbox>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox
      {...rest}
      class={`flex items-start gap-2 ${local.class ?? ""}`}
    />
  );
}

function Input(props: ComponentProps<typeof KCheckbox.Input>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Input
      {...rest}
      class={`peer absolute size-4 appearance-none opacity-0 ${local.class ?? ""}`}
    />
  );
}

function Control(props: ComponentProps<typeof KCheckbox.Control>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Control
      {...rest}
      class={`flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface text-primary-foreground transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[disabled]:opacity-50 motion-reduce:transition-none ${local.class ?? ""}`}
    />
  );
}

function Indicator(props: ComponentProps<typeof KCheckbox.Indicator>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Indicator
      {...rest}
      class={`flex items-center justify-center ${local.class ?? ""}`}
    >
      <Check size={12} strokeWidth={3} aria-hidden="true" />
    </KCheckbox.Indicator>
  );
}

function Label(props: ComponentProps<typeof KCheckbox.Label>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Label
      {...rest}
      class={`select-none text-sm text-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KCheckbox.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.Description
      {...rest}
      class={`text-xs text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function ErrorMessage(props: ComponentProps<typeof KCheckbox.ErrorMessage>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCheckbox.ErrorMessage
      {...rest}
      class={`text-xs font-medium text-danger ${local.class ?? ""}`}
    />
  );
}

export const Checkbox = { Root, Input, Control, Indicator, Label, Description, ErrorMessage };
