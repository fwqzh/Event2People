import Link from "next/link";
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
          <p>这里管理运行时配置。现在除了 Tavily，也可以统一保存主流大模型 Provider 的 API 信息。</p>
        </div>

        <div className="toolbar-card__actions">
          <Link href="/github" className="ghost-button">
            返回 GitHub
          </Link>
          <Link href="/arxiv" className="ghost-button">
            返回 arXiv
          </Link>
        </div>
      </section>

      <TavilySettingsPanel initialSnapshot={tavilySnapshot} />
      <LlmSettingsPanel initialSnapshots={llmSnapshots} />
    </div>
  );
}
