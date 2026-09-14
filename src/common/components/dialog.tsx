import { Dialog as KDialog } from "@kobalte/core/dialog";
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

/*
 * The scrim is a tinted dark (the neutral hue, not pure black) so the dimmed
 * page keeps its colour temperature, plus a 2px blur that separates the dialog
 * plane from the content behind it without hiding it outright.
 */
function Overlay(props: ComponentProps<typeof KDialog.Overlay>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Overlay
      {...rest}
      class={`animate-fade-in fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] ${local.class ?? ""}`}
    />
  );
}

function Content(props: ComponentProps<typeof KDialog.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  // No border: at this elevation the shadow carries the separation, and a
  // hairline on top of a shadow is the generic "card" look. `max-h` +
  // `overflow-y-auto` are defaults so no dialog can grow past the viewport.
  return (
    <KDialog.Content
      {...rest}
      class={`animate-surface-in fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-elevated p-5 text-foreground shadow-lg outline-none ${local.class ?? ""}`}
    />
  );
}

function Title(props: ComponentProps<typeof KDialog.Title>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Title
      {...rest}
      class={`pr-8 text-base font-semibold text-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KDialog.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Description
      {...rest}
      class={`mt-1 text-sm text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function CloseButton(props: ComponentProps<typeof KDialog.CloseButton>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.CloseButton
      {...rest}
      class={`absolute right-2.5 top-2.5 inline-flex size-7 items-center justify-center rounded-md text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground active:scale-90 focus-ring ${local.class ?? ""}`}
    >
      <X size={15} aria-hidden="true" />
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
