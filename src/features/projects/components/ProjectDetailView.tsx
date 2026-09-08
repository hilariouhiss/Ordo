import { useParams } from "@tanstack/solid-router";
import PlaceholderView from "../../../app/PlaceholderView";

export function ProjectDetailView() {
  const params = useParams({ from: "/projects/$projectId" });

  return (
    <PlaceholderView
      title="项目"
      description={`项目 ${params().projectId} 的详情、列表与看板视图将在后续里程碑中实现。`}
    />
  );
}
