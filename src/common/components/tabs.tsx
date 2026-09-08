import {
  Tabs as KTabs,
} from "@kobalte/core/tabs";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KTabs>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTabs {...rest} class={`flex flex-col ${local.class ?? ""}`} />;
}

function List(props: ComponentProps<typeof KTabs.List>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.List
      {...rest}
      class={`relative flex gap-1 border-b border-border ${local.class ?? ""}`}
    />
  );
}

function Trigger(props: ComponentProps<typeof KTabs.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.Trigger
      {...rest}
      class={`px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[selected]:text-foreground motion-reduce:transition-none ${local.class ?? ""}`}
    />
  );
}

function Content(props: ComponentProps<typeof KTabs.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.Content
      {...rest}
      class={`pt-3 outline-none ${local.class ?? ""}`}
    />
  );
}

function Indicator(props: ComponentProps<typeof KTabs.Indicator>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.Indicator
      {...rest}
      class={`absolute bottom-0 left-0 h-0.5 rounded-full bg-primary transition-transform motion-reduce:transition-none ${local.class ?? ""}`}
    />
  );
}

export const Tabs = { Root, List, Trigger, Content, Indicator };
