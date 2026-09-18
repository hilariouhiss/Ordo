import { Dialog as KDialog } from "@kobalte/core/dialog";
import { X } from "lucide-solid";
import { splitProps, type ComponentProps } from "solid-js";

function Root(props: ComponentProps<typeof KDialog>) {
  // Kobalte's own default for the close button's accessible name is the English
  // "Dismiss"; this UI is Chinese, and every call site that passes an explicit
  // `aria-label="关闭"` still wins over this.
  return <KDialog translations={{ dismiss: "关闭" }} {...props} />;
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
  const [local, rest] = splitProps(props, ["class", "onCloseAutoFocus"]);

  /*
   * Where focus goes when this dialog closes. Kobalte hands it back to the
   * `Dialog.Trigger`, and this app has none: every dialog opens from a menu
   * item, a row button or a file picker's result. With no trigger to hand it
   * back to, Kobalte still calls `preventDefault()` on its own restore (which
   * suppresses the focus scope's fallback) and then focuses `undefined`, so
   * focus landed on `<body>` and the next Tab restarted at the top of the
   * window instead of at the control the user opened.
   *
   * Captured here rather than in `onMount`: a component body runs before the
   * dialog's own autofocus effect, which is the moment the opener still holds
   * focus. A trigger, if one is ever used, is focused by the click that opens
   * the dialog, so this stays correct for that case too.
   */
  const opener = document.activeElement as HTMLElement | null;

  // No border: at this elevation the shadow carries the separation, and a
  // hairline on top of a shadow is the generic "card" look.
  //
  // The panel itself never scrolls (`max-h` + `overflow-hidden`); the body
  // below the header does, and each dialog marks that body with
  // `min-h-0 flex-1 overflow-y-auto`. Scrolling the whole panel is what used
  // to drag the title (and the close button pinned to its corner) off the top
  // of a long dialog. A `class` cannot do that from the outside: Tailwind
  // resolves `overflow-*` by source order, and `overflow-y-auto` is emitted
  // after `overflow-hidden`.
  return (
    <KDialog.Content
      {...rest}
      onCloseAutoFocus={(event) => {
        local.onCloseAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        opener?.focus();
      }}
      class={`animate-surface-in fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-elevated p-5 text-foreground shadow-lg outline-none ${local.class ?? ""}`}
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
