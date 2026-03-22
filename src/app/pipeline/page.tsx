import { PipelineWorkbench } from "@/components/pipeline-workbench";
import { getPipelineData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const entries = await getPipelineData();

  return (
    <div className="page-content">
      <PipelineWorkbench entries={entries} />
    </div>
  );
}
