import { subDays, subHours } from "date-fns";

import { buildPersonCopySummary } from "@/lib/copy";
import { clampZh, repoDisplayName, sentenceZh } from "@/lib/text";
import type { DatasetBundleInput, EventInput, EventTag, LinkItem, MetricItem, PipelineEntrySeedInput, PaperInput, PersonInput, ProjectInput } from "@/lib/types";

function metrics(items: Array<[string, string]>): MetricItem[] {
  return items.map(([label, value]) => ({ label, value }));
}

function links(items: Array<[string, string]>): LinkItem[] {
  return items.map(([label, url]) => ({ label, url }));
}

function githubCardTitle(repoName: string) {
  return clampZh(repoDisplayName(repoName), 32);
}

export function buildSampleDataset(now = new Date()): DatasetBundleInput {
  const people: PersonInput[] = [
    {
      stableId: "github:alice-chen",
      name: "Alice Chen",
      identitySummaryZh: "Stanford Robotics 博士生 · 前 DeepMind",
      evidenceSummaryZh: "创建 repo VoxAgent；实现 Paper “Robot Web Pilot”",
      sourceUrls: ["https://github.com/alice-chen", "https://scholar.google.com/citations?user=alice"],
      githubUrl: "https://github.com/alice-chen",
      scholarUrl: "https://scholar.google.com/citations?user=alice",
      homepageUrl: "https://alicechen.ai",
      organizationNamesRaw: ["Stanford Robotics"],
      schoolNamesRaw: ["Stanford University"],
      bioSnippetsRaw: ["PhD student in robotics and embodied agents."],
    },
    {
      stableId: "github:marvin-li",
      name: "Marvin Li",
      identitySummaryZh: "OpenAI 研究员 · 多模态推理方向",
      evidenceSummaryZh: "参与 OmniReason 核心开发；相关论文作者",
      sourceUrls: ["https://github.com/marvinli", "https://www.linkedin.com/in/marvinli"],
      githubUrl: "https://github.com/marvinli",
      linkedinUrl: "https://www.linkedin.com/in/marvinli",
      xUrl: "https://x.com/marvinli",
      organizationNamesRaw: ["OpenAI"],
      bioSnippetsRaw: ["Researcher working on multimodal reasoning."],
    },
    {
      stableId: "github:rina-park",
      name: "Rina Park",
      identitySummaryZh: "独立开发者 · 前 Google Brain",
      evidenceSummaryZh: "创建 BrowserLoop；近 7 天 stars 快速增长",
      sourceUrls: ["https://github.com/rinapark"],
      githubUrl: "https://github.com/rinapark",
      xUrl: "https://x.com/rinapark",
      founderHistoryRaw: ["Built devtools for agentic browsers."],
    },
    {
      stableId: "author:jian-wu",
      name: "Jian Wu",
      identitySummaryZh: "CMU 研究者 · 具身智能方向",
      evidenceSummaryZh: "是 Paper “Embodied Planning Kernel” 的作者",
      sourceUrls: ["https://scholar.google.com/citations?user=jianwu"],
      scholarUrl: "https://scholar.google.com/citations?user=jianwu",
      schoolNamesRaw: ["Carnegie Mellon University"],
    },
    {
      stableId: "author:sofia-garcia",
      name: "Sofia Garcia",
      identitySummaryZh: "MIT 教授 · CSAIL",
      evidenceSummaryZh: "发布新 paper；附公开代码入口",
      sourceUrls: ["https://www.mit.edu/~sofiagarcia"],
      homepageUrl: "https://www.mit.edu/~sofiagarcia",
      schoolNamesRaw: ["MIT"],
      labNamesRaw: ["CSAIL"],
    },
    {
      stableId: "github:noah-kim",
      name: "Noah Kim",
      identitySummaryZh: "NVIDIA 工程师 · 推理基础设施方向",
      evidenceSummaryZh: "参与 StreamForge 核心开发；出现在多个相关 repo 中",
      sourceUrls: ["https://github.com/noahkim"],
      githubUrl: "https://github.com/noahkim",
      organizationNamesRaw: ["NVIDIA"],
    },
  ];

  const projects: ProjectInput[] = [
    {
      stableId: "repo:alice-chen/vox-agent",
      repoName: "alice-chen/vox-agent",
      repoUrl: "https://github.com/alice-chen/vox-agent",
      ownerName: "Alice Chen",
      ownerUrl: "https://github.com/alice-chen",
      stars: 1280,
      starDelta7d: 312,
      contributorsCount: 8,
      repoCreatedAt: subDays(now, 3),
      repoUpdatedAt: subHours(now, 4),
      repoDescriptionRaw: "Embodied browsing agent for robot operation tasks.",
      readmeExcerptRaw: "Implementation for Robot Web Pilot with embodied planning kernel.",
      relatedPaperStableIds: ["paper:robot-web-pilot"],
    },
    {
      stableId: "repo:marvinli/omnireason",
      repoName: "marvinli/omnireason",
      repoUrl: "https://github.com/marvinli/omnireason",
      ownerName: "Marvin Li",
      ownerUrl: "https://github.com/marvinli",
      stars: 2310,
      starDelta7d: 420,
      contributorsCount: 14,
      repoCreatedAt: subDays(now, 8),
      repoUpdatedAt: subHours(now, 5),
      repoDescriptionRaw: "Multimodal reasoning stack for frontier models.",
      readmeExcerptRaw: "Supports VLM planning, reasoning traces, and evaluation.",
    },
    {
      stableId: "repo:rinapark/browserloop",
      repoName: "rinapark/browserloop",
      repoUrl: "https://github.com/rinapark/browserloop",
      ownerName: "Rina Park",
      ownerUrl: "https://github.com/rinapark",
      stars: 980,
      starDelta7d: 288,
      contributorsCount: 5,
      repoCreatedAt: subDays(now, 2),
      repoUpdatedAt: subHours(now, 2),
      repoDescriptionRaw: "Agent loop for browser-native workflows.",
      readmeExcerptRaw: "Tool-use runner for browser agents.",
    },
    {
      stableId: "repo:noahkim/streamforge",
      repoName: "noahkim/streamforge",
      repoUrl: "https://github.com/noahkim/streamforge",
      ownerName: "Noah Kim",
      ownerUrl: "https://github.com/noahkim",
      stars: 1442,
      starDelta7d: 198,
      contributorsCount: 11,
      repoCreatedAt: subDays(now, 10),
      repoUpdatedAt: subHours(now, 8),
      repoDescriptionRaw: "Open source infra for model streaming and observability.",
      readmeExcerptRaw: "Benchmark and eval stack for agent orchestration.",
    },
    {
      stableId: "repo:openvision/worldforge",
      repoName: "openvision/worldforge",
      repoUrl: "https://github.com/openvision/worldforge",
      ownerName: "OpenVision",
      ownerUrl: "https://github.com/openvision",
      stars: 1788,
      starDelta7d: 256,
      contributorsCount: 13,
      repoCreatedAt: subDays(now, 5),
      repoUpdatedAt: subHours(now, 6),
      repoDescriptionRaw: "World model toolkit for embodied simulation.",
      readmeExcerptRaw: "Simulation-first stack for embodied policy research.",
    },
    {
      stableId: "repo:audio-lab/voice-weaver",
      repoName: "audio-lab/voice-weaver",
      repoUrl: "https://github.com/audio-lab/voice-weaver",
      ownerName: "audio-lab",
      ownerUrl: "https://github.com/audio-lab",
      stars: 842,
      starDelta7d: 176,
      contributorsCount: 6,
      repoCreatedAt: subDays(now, 6),
      repoUpdatedAt: subHours(now, 11),
      repoDescriptionRaw: "Voice-native agent runtime.",
      readmeExcerptRaw: "Real-time speech interaction and planning.",
    },
  ];

  const papers: PaperInput[] = [
    {
      stableId: "paper:robot-web-pilot",
      paperTitle: "Robot Web Pilot",
      paperUrl: "https://arxiv.org/abs/2503.01001",
      authors: ["Alice Chen", "Jian Wu"],
      authorsCount: 2,
      publishedAt: subDays(now, 1),
      abstractRaw: "Embodied web interaction policy for robotics operators.",
      codeUrl: "https://github.com/alice-chen/vox-agent",
      institutionNamesRaw: ["Tsinghua University", "Shanghai AI Laboratory"],
      relatedProjectStableIds: ["repo:alice-chen/vox-agent"],
    },
    {
      stableId: "paper:embodied-planning-kernel",
      paperTitle: "Embodied Planning Kernel",
      paperUrl: "https://arxiv.org/abs/2503.01022",
      authors: ["Jian Wu", "Sofia Garcia"],
      authorsCount: 2,
      publishedAt: subDays(now, 2),
      abstractRaw: "Planning primitives for embodied agents in cluttered scenes.",
      institutionNamesRaw: ["Tsinghua University", "Shanghai AI Laboratory"],
    },
    {
      stableId: "paper:agent-observation-stack",
      paperTitle: "Agent Observation Stack",
      paperUrl: "https://arxiv.org/abs/2503.01035",
      authors: ["Marvin Li", "Noah Kim"],
      authorsCount: 2,
      publishedAt: subDays(now, 2),
      abstractRaw: "Observation and reasoning stack for multimodal enterprise agents.",
      institutionNamesRaw: ["OpenAI", "Stanford University"],
    },
    {
      stableId: "paper:open-voice-planner",
      paperTitle: "Open Voice Planner",
      paperUrl: "https://arxiv.org/abs/2503.01048",
      authors: ["Sofia Garcia"],
      authorsCount: 1,
      publishedAt: subDays(now, 3),
      abstractRaw: "Voice-first planning for conversational agents.",
      institutionNamesRaw: ["Audio Lab"],
      relatedProjectStableIds: ["repo:audio-lab/voice-weaver"],
    },
  ];

  const githubEvents: EventInput[] = [
    {
      stableId: "event:github:vox-agent",
      sourceType: "github",
      eventType: "implementation",
      eventTag: "Embodied AI",
      eventTagConfidence: 0.95,
      eventTitleZh: githubCardTitle("alice-chen/vox-agent"),
      eventHighlightZh: sentenceZh("用于具身浏览与机器人操作执行。", 20),
      eventDetailSummaryZh: "论文、repo 与人物关系完整，适合作为判断与存人的起点。",
      timePrimary: subHours(now, 6),
      metrics: metrics([
        ["时间", "6 小时前"],
        ["today stars", "+312"],
        ["Total Stars", "1280"],
      ]),
      sourceLinks: links([
        ["GitHub", "https://github.com/alice-chen/vox-agent"],
        ["Paper", "https://arxiv.org/abs/2503.01001"],
      ]),
      peopleDetectionStatus: "resolved",
      projectStableIds: ["repo:alice-chen/vox-agent"],
      paperStableIds: ["paper:robot-web-pilot"],
      personStableIds: ["github:alice-chen", "author:jian-wu"],
      displayRank: 1,
      relatedRepoCount: 1,
      relatedPaperCount: 1,
    },
    {
      stableId: "event:github:omnireason",
      sourceType: "github",
      eventType: "activity_spike",
      eventTag: "Multimodal",
      eventTagConfidence: 0.9,
      eventTitleZh: githubCardTitle("marvinli/omnireason"),
      eventHighlightZh: sentenceZh("用于多模态推理、规划与评测。", 20),
      timePrimary: subHours(now, 10),
      metrics: metrics([
        ["时间", "10 小时前"],
        ["today stars", "+420"],
        ["Total Stars", "2310"],
      ]),
      sourceLinks: links([["GitHub", "https://github.com/marvinli/omnireason"]]),
      peopleDetectionStatus: "resolved",
      projectStableIds: ["repo:marvinli/omnireason"],
      paperStableIds: [],
      personStableIds: ["github:marvin-li"],
      displayRank: 2,
      relatedRepoCount: 1,
      relatedPaperCount: 0,
    },
    {
      stableId: "event:github:browserloop",
      sourceType: "github",
      eventType: "new_repo",
      eventTag: "AI Agent",
      eventTagConfidence: 0.88,
      eventTitleZh: githubCardTitle("rinapark/browserloop"),
      eventHighlightZh: sentenceZh("用于浏览器工作流的 agent 循环。", 20),
      timePrimary: subHours(now, 14),
      metrics: metrics([
        ["时间", "14 小时前"],
        ["today stars", "+288"],
        ["Total Stars", "980"],
      ]),
      sourceLinks: links([["GitHub", "https://github.com/rinapark/browserloop"]]),
      peopleDetectionStatus: "resolved",
      projectStableIds: ["repo:rinapark/browserloop"],
      paperStableIds: [],
      personStableIds: ["github:rina-park"],
      displayRank: 3,
      relatedRepoCount: 1,
      relatedPaperCount: 0,
    },
    {
      stableId: "event:github:convergence-stack",
      sourceType: "github",
      eventType: "convergence",
      eventTag: "Research Infra",
      eventTagConfidence: 0.82,
      eventTitleZh: githubCardTitle("noahkim/streamforge"),
      eventHighlightZh: sentenceZh("用于 agent 编排、评测与观测。", 20),
      timePrimary: subHours(now, 20),
      metrics: metrics([
        ["时间", "20 小时前"],
        ["related repos", "3"],
        ["Total Stars", "4732"],
      ]),
      sourceLinks: links([
        ["StreamForge", "https://github.com/noahkim/streamforge"],
        ["BrowserLoop", "https://github.com/rinapark/browserloop"],
        ["OmniReason", "https://github.com/marvinli/omnireason"],
      ]),
      peopleDetectionStatus: "partial",
      projectStableIds: ["repo:noahkim/streamforge", "repo:rinapark/browserloop", "repo:marvinli/omnireason"],
      paperStableIds: [],
      personStableIds: ["github:noah-kim", "github:rina-park", "github:marvin-li"],
      displayRank: 4,
      relatedRepoCount: 3,
      relatedPaperCount: 0,
    },
    {
      stableId: "event:github:worldforge",
      sourceType: "github",
      eventType: "activity_spike",
      eventTag: "World Model",
      eventTagConfidence: 0.86,
      eventTitleZh: githubCardTitle("openvision/worldforge"),
      eventHighlightZh: sentenceZh("用于具身模拟与 world model 研究。", 20),
      timePrimary: subHours(now, 26),
      metrics: metrics([
        ["时间", "1 天前"],
        ["today stars", "+256"],
        ["Total Stars", "1788"],
      ]),
      sourceLinks: links([["GitHub", "https://github.com/openvision/worldforge"]]),
      peopleDetectionStatus: "missing",
      projectStableIds: ["repo:openvision/worldforge"],
      paperStableIds: [],
      personStableIds: [],
      displayRank: 5,
      relatedRepoCount: 1,
      relatedPaperCount: 0,
    },
    {
      stableId: "event:github:voice-weaver",
      sourceType: "github",
      eventType: "paper_with_code",
      eventTag: "Voice",
      eventTagConfidence: 0.84,
      eventTitleZh: githubCardTitle("audio-lab/voice-weaver"),
      eventHighlightZh: sentenceZh("用于语音交互与规划的 agent 运行时。", 20),
      timePrimary: subHours(now, 30),
      metrics: metrics([
        ["时间", "1 天前"],
        ["today stars", "+176"],
        ["Total Stars", "842"],
      ]),
      sourceLinks: links([
        ["GitHub", "https://github.com/audio-lab/voice-weaver"],
        ["Paper", "https://arxiv.org/abs/2503.01048"],
      ]),
      peopleDetectionStatus: "partial",
      projectStableIds: ["repo:audio-lab/voice-weaver"],
      paperStableIds: ["paper:open-voice-planner"],
      personStableIds: ["author:sofia-garcia"],
      displayRank: 6,
      relatedRepoCount: 1,
      relatedPaperCount: 1,
    },
  ];

  const arxivEvents: EventInput[] = [
    {
      stableId: "event:arxiv:robot-web-pilot",
      sourceType: "arxiv",
      eventType: "paper_with_code",
      eventTag: "Embodied AI",
      eventTagConfidence: 0.95,
      eventTitleZh: clampZh("新 paper “Robot Web Pilot” 发布并附代码", 32),
      eventHighlightZh: sentenceZh("研究入口已直接连接到可执行实现。", 20),
      timePrimary: subHours(now, 4),
      metrics: metrics([
        ["时间", "4 小时前"],
        ["authors", "2"],
        ["code", "有"],
      ]),
      sourceLinks: links([
        ["Paper", "https://arxiv.org/abs/2503.01001"],
        ["Code", "https://github.com/alice-chen/vox-agent"],
      ]),
      peopleDetectionStatus: "resolved",
      projectStableIds: ["repo:alice-chen/vox-agent"],
      paperStableIds: ["paper:robot-web-pilot"],
      personStableIds: ["github:alice-chen", "author:jian-wu"],
      displayRank: 1,
      relatedRepoCount: 1,
      relatedPaperCount: 1,
    },
    {
      stableId: "event:arxiv:planning-kernel",
      sourceType: "arxiv",
      eventType: "new_paper",
      eventTag: "Robotics",
      eventTagConfidence: 0.9,
      eventTitleZh: clampZh("新 paper “Embodied Planning Kernel” 发布", 32),
      eventHighlightZh: sentenceZh("具身智能规划方向出现值得优先跟进的新入口。", 20),
      timePrimary: subHours(now, 9),
      metrics: metrics([
        ["时间", "9 小时前"],
        ["authors", "2"],
        ["code", "无"],
      ]),
      sourceLinks: links([["Paper", "https://arxiv.org/abs/2503.01022"]]),
      peopleDetectionStatus: "resolved",
      projectStableIds: [],
      paperStableIds: ["paper:embodied-planning-kernel"],
      personStableIds: ["author:jian-wu", "author:sofia-garcia"],
      displayRank: 2,
      relatedRepoCount: 0,
      relatedPaperCount: 1,
    },
    {
      stableId: "event:arxiv:observation-stack",
      sourceType: "arxiv",
      eventType: "new_paper",
      eventTag: "AI Agent",
      eventTagConfidence: 0.86,
      eventTitleZh: clampZh("新 paper “Agent Observation Stack” 发布", 32),
      eventHighlightZh: sentenceZh("agent 观测与推理栈出现新的研究切口。", 20),
      timePrimary: subHours(now, 16),
      metrics: metrics([
        ["时间", "16 小时前"],
        ["authors", "2"],
        ["code", "无"],
      ]),
      sourceLinks: links([["Paper", "https://arxiv.org/abs/2503.01035"]]),
      peopleDetectionStatus: "partial",
      projectStableIds: [],
      paperStableIds: ["paper:agent-observation-stack"],
      personStableIds: ["github:marvin-li", "github:noah-kim"],
      displayRank: 3,
      relatedRepoCount: 0,
      relatedPaperCount: 1,
    },
    {
      stableId: "event:arxiv:voice-planner",
      sourceType: "arxiv",
      eventType: "implementation",
      eventTag: "Voice",
      eventTagConfidence: 0.84,
      eventTitleZh: clampZh("Paper “Open Voice Planner” 获得实现", 32),
      eventHighlightZh: sentenceZh("语音 agent 论文已出现可跟进实现。", 20),
      timePrimary: subHours(now, 24),
      metrics: metrics([
        ["时间", "1 天前"],
        ["authors", "1"],
        ["code", "有"],
      ]),
      sourceLinks: links([
        ["Paper", "https://arxiv.org/abs/2503.01048"],
        ["GitHub", "https://github.com/audio-lab/voice-weaver"],
      ]),
      peopleDetectionStatus: "resolved",
      projectStableIds: ["repo:audio-lab/voice-weaver"],
      paperStableIds: ["paper:open-voice-planner"],
      personStableIds: ["author:sofia-garcia"],
      displayRank: 4,
      relatedRepoCount: 1,
      relatedPaperCount: 1,
    },
  ];

  while (githubEvents.length < 12) {
    const index = githubEvents.length + 1;
    const tagPool: EventTag[] = ["AI Agent", "Robotics", "Open Source Infra", "Reasoning", "Coding Agent", "Multimodal"];
    const tag = tagPool[(index - 1) % tagPool.length];

    githubEvents.push({
      stableId: `event:github:auto-${index}`,
      sourceType: "github",
      eventType: index % 2 === 0 ? "new_repo" : "activity_spike",
      eventTag: tag,
      eventTagConfidence: 0.72,
      eventTitleZh: githubCardTitle(`example/project-${index}`),
      eventHighlightZh: sentenceZh(`这是一个聚焦 ${tag} 的 GitHub 项目。`, 20),
      timePrimary: subHours(now, 24 + index * 3),
      metrics: metrics([
        ["时间", `${1 + Math.floor(index / 4)} 天前`],
        ["today stars", `+${80 + index * 12}`],
        ["Total Stars", `${900 + index * 140}`],
      ]),
      sourceLinks: links([["GitHub", `https://github.com/example/event-${index}`]]),
      peopleDetectionStatus: index % 4 === 0 ? "missing" : "partial",
      projectStableIds: [],
      paperStableIds: [],
      personStableIds: index % 4 === 0 ? [] : ["github:rina-park"],
      displayRank: index,
      relatedRepoCount: 1,
      relatedPaperCount: 0,
    });
  }

  while (arxivEvents.length < 12) {
    const index = arxivEvents.length + 1;
    const tagPool: EventTag[] = ["Embodied AI", "AI Agent", "Multimodal", "Reasoning", "Robotics"];
    const tag = tagPool[(index - 1) % tagPool.length];

    arxivEvents.push({
      stableId: `event:arxiv:auto-${index}`,
      sourceType: "arxiv",
      eventType: index % 3 === 0 ? "paper_with_code" : "new_paper",
      eventTag: tag,
      eventTagConfidence: 0.7,
      eventTitleZh: clampZh(`新 paper ${index} 聚焦 ${tag}`, 32),
      eventHighlightZh: sentenceZh("相关论文流中出现新的研究入口。", 20),
      timePrimary: subHours(now, 18 + index * 4),
      metrics: metrics([
        ["时间", `${1 + Math.floor(index / 3)} 天前`],
        ["authors", `${1 + (index % 5)}`],
        ["code", index % 3 === 0 ? "有" : "无"],
      ]),
      sourceLinks: links([["Paper", `https://arxiv.org/abs/2503.01${100 + index}`]]),
      peopleDetectionStatus: index % 5 === 0 ? "missing" : "partial",
      projectStableIds: [],
      paperStableIds: [],
      personStableIds: index % 5 === 0 ? [] : ["author:jian-wu"],
      displayRank: index,
      relatedRepoCount: index % 3 === 0 ? 1 : 0,
      relatedPaperCount: 1,
    });
  }

  const pipelineEntries: PipelineEntrySeedInput[] = [
    {
      personStableId: "github:alice-chen",
      savedAt: subHours(now, 12),
      savedFromEventStableId: "event:github:vox-agent",
      savedFromEventTitle: "vox-agent",
      recentActivitySummaryZh: "创建 repo VoxAgent，近 7 天 +312 stars",
    },
    {
      personStableId: "github:marvin-li",
      savedAt: subDays(now, 1),
      savedFromEventStableId: "event:github:omnireason",
      savedFromEventTitle: "omnireason",
      recentActivitySummaryZh: "参与 OmniReason 核心开发，近 7 天 +420 stars",
    },
  ];

  for (const entry of pipelineEntries) {
    const person = people.find((candidate) => candidate.stableId === entry.personStableId);

    if (!person) {
      continue;
    }

    entry.copySummaryShortZh = buildPersonCopySummary(
      {
        ...person,
        links: person.sourceUrls.map((url) => ({ label: url.includes("github.com") ? "GitHub" : "外链", url })),
      },
      entry.savedFromEventTitle,
      entry.recentActivitySummaryZh,
    );
    entry.copySummaryFullZh = entry.copySummaryShortZh;
  }

  return {
    label: "内置示例数据",
    source: "sample",
    projects,
    papers,
    people,
    repoPaperLinks: [
      {
        projectStableId: "repo:alice-chen/vox-agent",
        paperStableId: "paper:robot-web-pilot",
        evidenceType: "readme_arxiv_link",
        evidenceSourceUrl: "https://github.com/alice-chen/vox-agent",
        evidenceExcerpt: "README 中存在 arXiv 链接",
        confidence: "confirmed",
      },
      {
        projectStableId: "repo:audio-lab/voice-weaver",
        paperStableId: "paper:open-voice-planner",
        evidenceType: "title_plus_context",
        evidenceSourceUrl: "https://github.com/audio-lab/voice-weaver",
        evidenceExcerpt: "标题高相关且描述中提及 planner",
        confidence: "confirmed",
      },
    ],
    events: [...githubEvents, ...arxivEvents],
    pipelineEntries,
  };
}
