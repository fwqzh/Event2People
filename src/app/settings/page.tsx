import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { TavilySettingsPanel } from "@/components/tavily-settings-panel";
import { getTavilySettingsSnapshot } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  noStore();
  const snapshot = await getTavilySettingsSnapshot();

  return (
    <div className="page-content settings-layout">
      <section className="toolbar-card toolbar-card--compact">
        <div className="toolbar-card__copy">
          <span className="section-kicker">Config / API</span>
          <h2>Settings</h2>
          <p>这里管理运行时配置。当前先开放 Tavily API Key，供项目搜索中文资料与外部来源时使用。</p>
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

      <TavilySettingsPanel initialSnapshot={snapshot} />
    </div>
  );
}
