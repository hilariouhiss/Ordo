import { Tabs as KTabs } from "@kobalte/core/tabs";
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
      class={`relative flex shrink-0 gap-1 border-b border-border ${local.class ?? ""}`}
    />
  );
}

function Trigger(props: ComponentProps<typeof KTabs.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.Trigger
      {...rest}
      class={`-mb-px select-none px-3 py-2 text-sm font-medium text-muted-foreground transition duration-150 ease-out hover:text-foreground data-[selected]:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-ring ${local.class ?? ""}`}
    />
  );
}

function Content(props: ComponentProps<typeof KTabs.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  // No padding here on purpose: every consumer supplies its own, and a base
  // padding would out-rank the caller's override (Tailwind resolves conflicts
  // by source order, not by class-attribute order).
  return <KTabs.Content {...rest} class={`outline-none ${local.class ?? ""}`} />;
}

function Indicator(props: ComponentProps<typeof KTabs.Indicator>) {
  const [local, rest] = splitProps(props, ["class"]);
  // 2px rather than 1px: at this scale a hairline underline reads as a border
  // rather than as the selected-state marker. The transition is on `transform`
  // so the slide between tabs stays on the compositor.
  return (
    <KTabs.Indicator
      {...rest}
      class={`absolute bottom-0 left-0 h-0.5 rounded-full bg-primary transition-transform duration-200 ease-out ${local.class ?? ""}`}
    />
  );
}

export const Tabs = { Root, List, Trigger, Content, Indicator };
