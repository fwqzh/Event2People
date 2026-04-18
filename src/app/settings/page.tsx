import { unstable_noStore as noStore } from "next/cache";

import { LlmSettingsPanel } from "@/components/llm-settings-panel";
import { TavilySettingsPanel } from "@/components/tavily-settings-panel";
import { getAllLlmProviderSettingsSnapshots, getTavilySettingsSnapshot } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  noStore();
  const [tavilySnapshot, llmSnapshots] = await Promise.all([
    getTavilySettingsSnapshot(),
    getAllLlmProviderSettingsSnapshots(),
  ]);

  return (
    <div className="page-content settings-layout">
      <section className="toolbar-card toolbar-card--compact">
        <div className="toolbar-card__copy">
          <span className="section-kicker">Config / API</span>
          <h2>Settings</h2>
          <p>如刷新后出现文案混乱或信息缺失问题，可先检查API额度剩余情况。</p>
        </div>
      </section>

      <TavilySettingsPanel initialSnapshot={tavilySnapshot} />
      <LlmSettingsPanel initialSnapshots={llmSnapshots} />
    </div>
  );
}
