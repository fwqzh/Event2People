import { EventBoard } from "@/components/event-board";
import { getKickstarterPageData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function KickstarterPage() {
  const data = await getKickstarterPageData();

  return (
    <div className="page-content">
      <EventBoard
        datasetVersionId={data.datasetVersionId}
        savedPersonStableIds={data.savedPersonStableIds}
        githubEvents={data.githubEvents}
        kickstarterEvents={data.kickstarterEvents}
        arxivEvents={data.arxivEvents}
        visibleSources={["kickstarter"]}
      />
    </div>
  );
}
