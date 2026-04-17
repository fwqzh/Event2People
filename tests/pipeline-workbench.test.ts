// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineWorkbench } from "@/components/pipeline-workbench";
import type { PipelineEntryView } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...props }, children),
}));

function createEntry(overrides: Partial<PipelineEntryView> = {}): PipelineEntryView {
  return {
    personStableId: "github:alice-chen",
    savedAt: new Date("2026-04-15T12:00:00.000Z"),
    savedFromEventStableId: "event:github:vox-agent",
    savedFromEventTitle: "vox-agent",
    recentActivitySummaryZh: "最近活动：创建 repo VoxAgent，近 7 天 +312 stars",
    copySummaryShortZh: "Alice",
    copySummaryFullZh: "Alice full",
    status: null,
    lastContactedAt: null,
    notes: null,
    featuredItem: {
      title: "example/vox-agent",
      url: "https://github.com/example/vox-agent",
      introZh: "用于浏览器工作流的 agent 执行循环。",
    },
    originalEvent: {
      sourceLabel: "来源：GitHub",
      eventTag: "AI Agent",
      title: "vox-agent",
      summaryZh: "这是原始卡片里的项目摘要。",
      timeAgo: "2 小时前",
      sourceLinks: [{ label: "GitHub", url: "https://github.com/example/vox-agent" }],
    },
    originalCardHref: "/github?event=event%3Agithub%3Avox-agent",
    sourceLabel: "来源：GitHub",
    person: {
      stableId: "github:alice-chen",
      name: "Alice Chen",
      identitySummaryZh: "专注 agent runtime 的开源构建者",
      evidenceSummaryZh: "创建相关 repo 并持续维护",
      sourceUrls: ["https://github.com/alice-chen"],
      githubUrl: "https://github.com/alice-chen",
      scholarUrl: null,
      linkedinUrl: null,
      xUrl: null,
      homepageUrl: "https://alice.example.com",
      email: "alice@example.com",
      organizationNamesRaw: ["OpenAI"],
      schoolNamesRaw: [],
      labNamesRaw: [],
      bioSnippetsRaw: [],
      founderHistoryRaw: [],
      links: [
        { label: "GitHub", url: "https://github.com/alice-chen" },
        { label: "Email", url: "mailto:alice@example.com" },
      ],
    },
    timeAgo: "1 天前",
    ...overrides,
  };
}

describe("PipelineWorkbench", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the simplified card with project link and direct contact links", async () => {
    const user = userEvent.setup();

    render(React.createElement(PipelineWorkbench, { entries: [createEntry()] }));

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("来源：GitHub")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("用于浏览器工作流的 agent 执行循环。")).toBeInTheDocument();
    expect(screen.getByText("项目原始链接")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看项目/作品" })).toHaveAttribute("href", "https://github.com/example/vox-agent");
    expect(screen.getByRole("button", { name: "展开原始卡片" })).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://github.com/alice-chen" })).toHaveAttribute("href", "https://github.com/alice-chen");
    expect(screen.getByRole("link", { name: "mailto:alice@example.com" })).toHaveAttribute("href", "mailto:alice@example.com");
    await user.click(screen.getByRole("button", { name: "展开原始卡片" }));
    expect(screen.getByText("这是原始卡片里的项目摘要。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在来源页打开" })).toHaveAttribute("href", "/github?event=event%3Agithub%3Avox-agent");
    expect(screen.queryByRole("button", { name: "详情" })).not.toBeInTheDocument();
    expect(screen.queryByText("联系")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
    expect(screen.queryByText("Selected Person")).not.toBeInTheDocument();
  }, 10000);

  it("keeps the empty state when there are no saved people", () => {
    render(React.createElement(PipelineWorkbench, { entries: [] }));

    expect(screen.getByText("当前 Pipeline 为空。")).toBeInTheDocument();
    expect(screen.queryByText("尚未保存任何人物。")).not.toBeInTheDocument();
  });
});
