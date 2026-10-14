import { Tabs as KTabs } from "@kobalte/core/tabs";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KTabs>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTabs {...rest} class={`flex flex-col ${local.class ?? ""}`} />;
}

function List(props: ComponentProps<typeof KTabs.List>) {
  const [local, rest] = splitProps(props, ["class"]);
  // `tabs-border` gives every tab its own underline rail (`base-300`) that the
  // selected tab repaints — see `Trigger` for the green override.
  //
  // `--tab-height` is daisyUI's own knob for the tab box, so overriding the
  // variable keeps the control at the app's 36px row height. Stating `h-9`
  // instead would silently lose: daisyUI styles tabs through
  // `.tab:is(.tabs > .tab)`, a descendant selector that out-ranks a plain
  // utility.
  return (
    <KTabs.List
      {...rest}
      class={`tabs tabs-border [--tab-height:2.25rem] shrink-0 gap-1 ${local.class ?? ""}`}
    />
  );
}

function Trigger(props: ComponentProps<typeof KTabs.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  // The label size, label colour and focus ring are daisyUI's (its rules out-
  // rank plain utilities here; see `List`). The one thing stated with the
  // important marker is the bar under the selected tab: daisyUI paints it
  // `currentColor` — the label colour — and the app's selected-tab mark has
  // always been the brand accent rather than the text.
  return (
    <KTabs.Trigger
      {...rest}
      class={`tab select-none data-[selected]:before:bg-primary! focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${local.class ?? ""}`}
    />
  );
}

function Content(props: ComponentProps<typeof KTabs.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  // No padding here on purpose: every consumer supplies its own, and a base
  // padding would out-rank the caller's override (Tailwind resolves conflicts
  // by source order, not by class-attribute order).
  //
  // `focus-ring` sits alongside `outline-none` because Kobalte only drops the
  // panel out of the tab order while it *contains* a tabbable element: a panel
  // whose content is all static text is Tab-reachable, and used to be reachable
  // with no focus indicator at all.
  return (
    <KTabs.Content {...rest} class={`tab-content outline-none focus-ring ${local.class ?? ""}`} />
  );
}

// The hand-rolled sliding indicator is gone: daisyUI's `tabs-border` draws the
// underline itself, per tab, so there is one mechanism instead of two.
export const Tabs = { Root, List, Trigger, Content };
