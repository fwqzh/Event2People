import { EventBoard } from "@/components/event-board";
import { getHomepageData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getHomepageData();

  return (
    <div className="page-content">
      <EventBoard githubEvents={data.githubEvents} arxivEvents={data.arxivEvents} />
    </div>
  );
}
