import {
  Dialog as KDialog,
} from "@kobalte/core/dialog";
import { X } from "lucide-solid";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KDialog>) {
  return <KDialog {...props} />;
}

function Trigger(props: ComponentProps<typeof KDialog.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDialog.Trigger {...rest} class={local.class} />;
}

function Portal(props: ComponentProps<typeof KDialog.Portal>) {
  return <KDialog.Portal {...props} />;
}

function Overlay(props: ComponentProps<typeof KDialog.Overlay>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Overlay
      {...rest}
      class={`fixed inset-0 z-50 bg-black/50 ${local.class ?? ""}`}
    />
  );
}

function Content(props: ComponentProps<typeof KDialog.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Content
      {...rest}
      class={`fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-elevated p-6 text-foreground shadow-lg outline-none ${local.class ?? ""}`}
    />
  );
}

function Title(props: ComponentProps<typeof KDialog.Title>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Title
      {...rest}
      class={`text-lg font-semibold text-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KDialog.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Description
      {...rest}
      class={`text-sm text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function CloseButton(props: ComponentProps<typeof KDialog.CloseButton>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.CloseButton
      {...rest}
      class={`absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${local.class ?? ""}`}
    >
      <X size={16} aria-hidden="true" />
    </KDialog.CloseButton>
  );
}

export const Dialog = {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  CloseButton,
};
