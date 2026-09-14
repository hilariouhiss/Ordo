import { FileQuestion } from "lucide-solid";
import { EmptyState } from "../common/components";

export default function PlaceholderView(props: { title: string; description: string }) {
  return (
    <div class="flex h-full min-h-64 flex-col">
      <EmptyState
        icon={<FileQuestion size={22} />}
        title={props.title}
        description={props.description}
      />
    </div>
  );
}
