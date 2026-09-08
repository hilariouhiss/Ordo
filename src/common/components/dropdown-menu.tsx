import {
  DropdownMenu as KDropdownMenu,
} from "@kobalte/core/dropdown-menu";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KDropdownMenu>) {
  return <KDropdownMenu {...props} />;
}

function Trigger(props: ComponentProps<typeof KDropdownMenu.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDropdownMenu.Trigger {...rest} class={local.class} />;
}

function Portal(props: ComponentProps<typeof KDropdownMenu.Portal>) {
  return <KDropdownMenu.Portal {...props} />;
}

function Content(props: ComponentProps<typeof KDropdownMenu.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.Content
      {...rest}
      class={`z-50 min-w-36 rounded-md border border-border bg-elevated p-1 text-foreground shadow-lg outline-none ${local.class ?? ""}`}
    />
  );
}

function Item(props: ComponentProps<typeof KDropdownMenu.Item>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.Item
      {...rest}
      class={`flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${local.class ?? ""}`}
    />
  );
}

function Group(props: ComponentProps<typeof KDropdownMenu.Group>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDropdownMenu.Group {...rest} class={local.class} />;
}

function GroupLabel(props: ComponentProps<typeof KDropdownMenu.GroupLabel>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.GroupLabel
      {...rest}
      class={`px-2 py-1.5 text-xs font-medium text-subtle-foreground ${local.class ?? ""}`}
    />
  );
}

function Separator(props: ComponentProps<typeof KDropdownMenu.Separator>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDropdownMenu.Separator {...rest} class={`my-1 h-px bg-border ${local.class ?? ""}`} />;
}

export const DropdownMenu = { Root, Trigger, Portal, Content, Item, Group, GroupLabel, Separator };
