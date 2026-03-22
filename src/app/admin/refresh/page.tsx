import { AdminRefreshPanel } from "@/components/admin-refresh-panel";
import { isAdminAuthorized } from "@/lib/admin-session";
import { getAdminData } from "@/lib/data";
import { env, hasOpenAiKey } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminRefreshPage() {
  const [authorized, runs] = await Promise.all([isAdminAuthorized(), getAdminData()]);

  return (
    <div className="page-content">
      <AdminRefreshPanel authorized={authorized} runs={runs} aiEnabled={hasOpenAiKey} aiModel={hasOpenAiKey ? env.openAiModel : null} />
    </div>
  );
}
