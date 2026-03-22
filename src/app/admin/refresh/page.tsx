import { AdminRefreshPanel } from "@/components/admin-refresh-panel";
import { getAdminData } from "@/lib/data";
import { env, hasOpenAiKey } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminRefreshPage() {
  const runs = await getAdminData();

  return (
    <div className="page-content">
      <AdminRefreshPanel runs={runs} aiEnabled={hasOpenAiKey} aiModel={hasOpenAiKey ? env.openAiModel : null} />
    </div>
  );
}
