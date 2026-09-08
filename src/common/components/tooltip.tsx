import {
  Tooltip as KTooltip,
} from "@kobalte/core/tooltip";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KTooltip>) {
  return <KTooltip {...props} />;
}

function Trigger(props: ComponentProps<typeof KTooltip.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTooltip.Trigger {...rest} class={local.class} />;
}

function Portal(props: ComponentProps<typeof KTooltip.Portal>) {
  return <KTooltip.Portal {...props} />;
}

function Content(props: ComponentProps<typeof KTooltip.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTooltip.Content
      {...rest}
      class={`z-50 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-foreground shadow-md ${local.class ?? ""}`}
    />
  );
}

function Arrow(props: ComponentProps<typeof KTooltip.Arrow>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTooltip.Arrow {...rest} class={`fill-elevated ${local.class ?? ""}`} />;
}

export const Tooltip = { Root, Trigger, Portal, Content, Arrow };
