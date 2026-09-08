import {
  Popover as KPopover,
} from "@kobalte/core/popover";
import { X } from "lucide-solid";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KPopover>) {
  return <KPopover {...props} />;
}

function Trigger(props: ComponentProps<typeof KPopover.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KPopover.Trigger {...rest} class={local.class} />;
}

function Portal(props: ComponentProps<typeof KPopover.Portal>) {
  return <KPopover.Portal {...props} />;
}

function Content(props: ComponentProps<typeof KPopover.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KPopover.Content
      {...rest}
      class={`z-50 w-72 rounded-lg border border-border bg-elevated p-4 text-foreground shadow-lg outline-none ${local.class ?? ""}`}
    />
  );
}

function Title(props: ComponentProps<typeof KPopover.Title>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KPopover.Title
      {...rest}
      class={`text-sm font-semibold text-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KPopover.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KPopover.Description
      {...rest}
      class={`text-sm text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function CloseButton(props: ComponentProps<typeof KPopover.CloseButton>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KPopover.CloseButton
      {...rest}
      class={`absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${local.class ?? ""}`}
    >
      <X size={14} aria-hidden="true" />
    </KPopover.CloseButton>
  );
}

function Arrow(props: ComponentProps<typeof KPopover.Arrow>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KPopover.Arrow {...rest} class={`fill-elevated ${local.class ?? ""}`} />;
}

export const Popover = { Root, Trigger, Portal, Content, Title, Description, CloseButton, Arrow };
