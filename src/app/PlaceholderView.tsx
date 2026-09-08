export default function PlaceholderView(props: { title: string; description: string }) {
  return (
    <div class="flex h-full min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 class="text-lg font-semibold text-foreground">{props.title}</h2>
      <p class="max-w-sm text-sm text-muted-foreground">{props.description}</p>
    </div>
  );
}
