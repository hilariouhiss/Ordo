import { Checkbox as KCheckbox } from "@kobalte/core/checkbox";
import { Check } from "lucide-solid";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KCheckbox>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KCheckbox {...rest} class={`flex items-start gap-2 ${local.class ?? ""}`} />;
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
  // The real `<input>` is visually hidden but still the focused element, so the
  // indicator has to be drawn through `peer-focus-visible` — the `focus-ring`
  // utility can't reach it. Same outline recipe, applied to the peer instead.
  return (
    <KCheckbox.Control
      {...rest}
      class={`flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-surface text-primary-foreground transition duration-150 ease-out hover:border-primary active:scale-90 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:hover:bg-primary-hover data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${local.class ?? ""}`}
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
      <Check size={11} strokeWidth={3.5} aria-hidden="true" />
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
