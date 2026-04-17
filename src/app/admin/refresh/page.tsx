import { AdminRefreshPanel } from "@/components/admin-refresh-panel";
import { getAdminData } from "@/lib/data";
import { getOpenAiRuntimeConfig } from "@/lib/openai-runtime";

export const dynamic = "force-dynamic";

export default async function AdminRefreshPage() {
  const runs = await getAdminData();
  const openAiConfig = await getOpenAiRuntimeConfig();

  return (
    <div className="page-content">
      <AdminRefreshPanel
        runs={runs}
        aiEnabled={openAiConfig.configured}
        aiModel={openAiConfig.configured ? openAiConfig.model : null}
        aiSource={openAiConfig.apiKeySource}
      />
    </div>
  );
}
