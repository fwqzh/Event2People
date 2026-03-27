import { EventBoard } from "@/components/event-board";
import { getArxivPageData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArxivPage() {
  const data = await getArxivPageData();

  return (
    <div className="page-content">
      <EventBoard
        datasetVersionId={data.datasetVersionId}
        savedPersonStableIds={data.savedPersonStableIds}
        githubEvents={data.githubEvents}
        arxivEvents={data.arxivEvents}
        visibleSources={["arxiv"]}
        enableArxivFilters
      />
    </div>
  );
}
