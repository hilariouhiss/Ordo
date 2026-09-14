import {
  Select as KSelect,
  type SelectRootProps as KSelectRootProps,
  type SelectRootItemComponentProps,
} from "@kobalte/core/select";
import { Check, ChevronDown } from "lucide-solid";
import { splitProps, type Component, type ComponentProps, type JSX } from "solid-js";

type SelectBaseProps<T> = {
  options: T[];
  optionValue: (option: T) => string;
  optionTextValue?: (option: T) => string;
  itemToString: (option: T) => string;
  renderItem?: (option: T) => JSX.Element;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  class?: string;
  children?: JSX.Element;
};

export type SelectRootProps<T> = SelectBaseProps<T> &
  (
    | { multiple?: false; value?: T | null; onChange?: (value: T | null) => void }
    | { multiple: true; value?: T[]; onChange?: (value: T[]) => void }
  );

function Root<T>(props: SelectRootProps<T>) {
  const [local, rest] = splitProps(props, ["class", "renderItem", "itemToString"]);

  const itemComponent: Component<SelectRootItemComponentProps<T>> = (p) => (
    <Item item={p.item}>
      {local.renderItem ? local.renderItem(p.item.rawValue) : local.itemToString(p.item.rawValue)}
      <ItemIndicator class="ml-auto flex items-center">
        <Check size={14} aria-hidden="true" />
      </ItemIndicator>
    </Item>
  );

  return (
    // Both branches of the wrapper's multiple/single union satisfy Kobalte's
    // discriminated union, so the cast only bridges two equivalent shapes.
    <KSelect<T>
      {...(rest as KSelectRootProps<T>)}
      itemComponent={itemComponent}
      class={`flex flex-col gap-1.5 ${local.class ?? ""}`}
    />
  );
}

function Trigger(props: ComponentProps<typeof KSelect.Trigger>) {
  const [local, rest] = splitProps(props, ["class"]);
  // No `w-full`: the trigger is the only child of `Root`'s flex column, so it
  // already stretches to the root's width. Carrying it anyway is not merely
  // redundant — Tailwind emits `.w-full` after every `.w-<n>`, so it silently
  // beat any width a caller asked for and made fixed-width triggers impossible.
  return (
    <KSelect.Trigger
      {...rest}
      class={`flex h-8 select-none items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-danger focus-ring ${local.class ?? ""}`}
    />
  );
}

function Value(props: ComponentProps<typeof KSelect.Value>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Value
      {...rest}
      class={`flex-1 truncate text-left data-[placeholder-shown]:text-subtle-foreground ${local.class ?? ""}`}
    />
  );
}

function Icon(props: ComponentProps<typeof KSelect.Icon>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Icon
      {...rest}
      class={`flex items-center text-subtle-foreground transition-transform duration-200 ease-out data-[expanded]:rotate-180 ${local.class ?? ""}`}
    >
      <ChevronDown size={14} aria-hidden="true" />
    </KSelect.Icon>
  );
}

function Content(props: ComponentProps<typeof KSelect.Content>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Content
      {...rest}
      class={`animate-surface-in z-50 max-h-64 min-w-32 overflow-y-auto rounded-lg bg-elevated p-1 text-foreground shadow-lg ${local.class ?? ""}`}
    />
  );
}

function Listbox(props: ComponentProps<typeof KSelect.Listbox>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Listbox
      {...rest}
      class={`flex flex-col gap-0.5 outline-none ${local.class ?? ""}`}
    />
  );
}

function Item(props: ComponentProps<typeof KSelect.Item>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Item
      {...rest}
      class={`flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-hover data-[selected]:font-medium data-[selected]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${local.class ?? ""}`}
    />
  );
}

function ItemIndicator(props: ComponentProps<typeof KSelect.ItemIndicator>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KSelect.ItemIndicator {...rest} class={`text-primary ${local.class ?? ""}`} />;
}

function Label(props: ComponentProps<typeof KSelect.Label>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Label
      {...rest}
      class={`text-xs font-medium text-muted-foreground ${local.class ?? ""}`}
    />
  );
}

function Description(props: ComponentProps<typeof KSelect.Description>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.Description
      {...rest}
      class={`text-xs text-subtle-foreground ${local.class ?? ""}`}
    />
  );
}

function ErrorMessage(props: ComponentProps<typeof KSelect.ErrorMessage>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KSelect.ErrorMessage
      {...rest}
      class={`text-xs font-medium text-danger ${local.class ?? ""}`}
    />
  );
}

export const Select = {
  Root,
  Trigger,
  Value,
  Icon,
  Content,
  Listbox,
  Item,
  ItemIndicator,
  Label,
  Description,
  ErrorMessage,
};
