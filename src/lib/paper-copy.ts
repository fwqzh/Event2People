import { clampPlainText } from "@/lib/text";
import type { EventTag } from "@/lib/types";

export type PaperExplanationView = {
  lead: string;
  problem: string;
  method: string;
  contribution: string;
};

export type PaperTopicView = {
  topic: string;
  keywords: string[];
};

type PaperNarrativeInput = {
  paperTitle: string;
  contentRaw?: string | null;
  abstractRaw?: string | null;
  eventTag: EventTag;
  hasCode: boolean;
  relatedRepoCount?: number | null;
};

type FocusCategory =
  | "benchmark"
  | "planning"
  | "system"
  | "policy"
  | "observation"
  | "simulation"
  | "model";

type FocusRule = {
  category: FocusCategory;
  artifactLabel: string;
  titleKeywords: string[];
  abstractKeywords: string[];
  minScore?: number;
};

type PolicyDetailRule = {
  keywords: string[];
  label: string;
};

const TOPIC_RULES: Array<{ keywords: string[]; label: string }> = [
  { keywords: ["web", "browser"], label: "网页交互" },
  { keywords: ["robot", "robotics", "manipulation", "locomotion"], label: "机器人执行" },
  { keywords: ["embodied"], label: "具身智能任务" },
  { keywords: ["agent", "tool use", "computer use"], label: "Agent 执行链路" },
  { keywords: ["voice", "speech", "audio"], label: "语音交互" },
  { keywords: ["video"], label: "视频理解与生成" },
  { keywords: ["multimodal", "vision-language", "vision", "vlm"], label: "多模态感知与推理" },
  { keywords: ["observation", "perception"], label: "观测建模" },
  { keywords: ["planning", "planner", "search"], label: "复杂任务规划" },
  { keywords: ["benchmark", "dataset", "leaderboard", "task suite", "evaluation suite"], label: "研究评测" },
  { keywords: ["simulation", "simulator", "world model"], label: "环境建模与仿真" },
];

const FOCUS_RULES: FocusRule[] = [
  {
    category: "planning",
    artifactLabel: "规划内核与决策原语",
    titleKeywords: ["planning", "planner", "replanning", "task planning", "search", "kernel", "primitive"],
    abstractKeywords: ["planning", "planner", "replan", "task planning", "search", "decision step", "decision primitive"],
  },
  {
    category: "policy",
    artifactLabel: "执行策略",
    titleKeywords: ["policy", "controller", "control", "reward", "grasp", "manipulation"],
    abstractKeywords: ["policy", "controller", "reward", "action generation", "grasp", "manipulation", "control"],
  },
  {
    category: "system",
    artifactLabel: "系统栈与模块接口",
    titleKeywords: ["framework", "pipeline", "runtime", "system", "stack"],
    abstractKeywords: ["framework", "pipeline", "runtime", "system", "modular", "workflow"],
  },
  {
    category: "observation",
    artifactLabel: "观测表示与状态建模",
    titleKeywords: ["observation", "perception", "memory", "representation", "feature", "mechanistic"],
    abstractKeywords: ["observation", "perception", "memory", "representation", "feature", "latent"],
  },
  {
    category: "simulation",
    artifactLabel: "仿真器或世界模型",
    titleKeywords: ["simulation", "simulator", "world model", "sim-to-real"],
    abstractKeywords: ["simulation", "simulator", "world model", "sim-to-real"],
  },
  {
    category: "benchmark",
    artifactLabel: "评测基准与任务定义",
    titleKeywords: ["benchmark", "dataset", "leaderboard", "task suite", "evaluation suite"],
    abstractKeywords: [
      "benchmark",
      "leaderboard",
      "task suite",
      "evaluation suite",
      "new dataset",
      "release dataset",
      "construct dataset",
      "dataset over",
    ],
    minScore: 2,
  },
];

const POLICY_DETAIL_RULES: PolicyDetailRule[] = [
  { keywords: ["push", "grasp", "clutter"], label: "推抓协同操作" },
  { keywords: ["dexterous", "hand", "egocentric"], label: "灵巧手控制" },
  { keywords: ["reward", "intent", "demonstration", "test-time"], label: "奖励建模与意图泛化" },
  { keywords: ["social", "behavior", "critic"], label: "社交行为生成" },
  { keywords: ["photography", "aesthetic", "viewpoint", "camera"], label: "摄影构图与视角控制" },
  { keywords: ["visuomotor", "flow"], label: "视觉驱动动作生成" },
  { keywords: ["multi-task", "reinforcement learning"], label: "多任务机械臂操作" },
  { keywords: ["manipulation"], label: "机械臂操作" },
];

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(haystack: string, keyword: string) {
  const normalizedKeyword = escapeRegExp(keyword.toLowerCase()).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${normalizedKeyword}([^a-z0-9]|$)`, "i").test(haystack);
}

function hasAnyKeyword(haystack: string, keywords: string[]) {
  return keywords.some((keyword) => hasKeyword(haystack, keyword));
}

function countKeywordHits(haystack: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => count + (hasKeyword(haystack, keyword) ? 1 : 0), 0);
}

function getTagTopicLabel(eventTag: EventTag) {
  switch (eventTag) {
    case "Embodied AI":
      return "具身智能任务";
    case "Robotics":
      return "机器人执行";
    case "AI Agent":
      return "Agent 执行链路";
    case "Coding Agent":
      return "编码 Agent";
    case "Reasoning":
      return "复杂任务规划";
    case "Research Infra":
      return "研究评测";
    case "Voice":
      return "语音交互";
    case "Video":
      return "视频理解与生成";
    case "World Model":
      return "环境建模与仿真";
    case "Multimodal":
      return "多模态感知与推理";
    case "Open Source Infra":
      return "系统基础设施";
    default:
      return "相关任务";
  }
}

function getFocusTopicLabel(focus: FocusCategory) {
  switch (focus) {
    case "benchmark":
      return "研究评测";
    case "planning":
      return "复杂任务规划";
    case "system":
      return "系统编排与执行";
    case "policy":
      return "执行策略";
    case "observation":
      return "观测建模";
    case "simulation":
      return "环境建模与仿真";
    case "model":
    default:
      return "";
  }
}

function getTopicLabel(haystack: string, eventTag: EventTag, focus: FocusCategory) {
  const labels = [
    getFocusTopicLabel(focus),
    ...TOPIC_RULES.filter((rule) => hasAnyKeyword(haystack, rule.keywords)).map((rule) => rule.label),
  ].filter(Boolean);

  if (labels.length === 0) {
    return getTagTopicLabel(eventTag);
  }

  return [...new Set(labels)].slice(0, 2).join("与");
}

function getPaperHandle(paperTitle: string, abstractRaw?: string | null) {
  const normalizedTitle = compactText(paperTitle).replace(/[“”]/g, "\"");
  const titlePrefix = normalizedTitle.split(":")[0]?.trim();

  if (normalizedTitle.includes(":") && titlePrefix && titlePrefix.length <= 40) {
    return titlePrefix;
  }

  const abstractText = compactText(abstractRaw);
  const abstractMatch = abstractText.match(
    /\b(?:we|this (?:paper|study))\s+(?:introduce|introduces|present|presents|propose|proposes)\s+([A-Z][A-Za-z0-9-]{1,}(?:\s+[A-Z][A-Za-z0-9-]{1,}){0,2})\b/,
  );

  if (abstractMatch?.[1]) {
    return abstractMatch[1].trim();
  }

  if (normalizedTitle.length <= 36) {
    return normalizedTitle;
  }

  return "";
}

function getFocusDescriptor(paperTitle: string, abstractRaw?: string | null) {
  const titleHaystack = compactText(paperTitle).toLowerCase();
  const abstractHaystack = compactText(abstractRaw).toLowerCase();
  let bestRule: { category: FocusCategory; artifactLabel: string; score: number } = {
    category: "model",
    artifactLabel: "方法框架",
    score: 0,
  };

  for (const rule of FOCUS_RULES) {
    const score = countKeywordHits(titleHaystack, rule.titleKeywords) * 3 + countKeywordHits(abstractHaystack, rule.abstractKeywords);

    if (score < (rule.minScore ?? 1) || score <= bestRule.score) {
      continue;
    }

    bestRule = {
      category: rule.category,
      artifactLabel: rule.artifactLabel,
      score,
    };
  }

  return {
    category: bestRule.category,
    artifactLabel: bestRule.artifactLabel,
  };
}

function getPolicyExecutionLabel(haystack: string) {
  return POLICY_DETAIL_RULES.find((rule) => hasAnyKeyword(haystack, rule.keywords))?.label ?? "动作生成与控制";
}

function buildProblemSentence(topicLabel: string, focus: FocusCategory, focusDetailLabel = "") {
  switch (focus) {
    case "benchmark":
      return `这篇论文想解决的是 ${topicLabel} 方向里任务定义分散、评测口径不统一，导致不同方案难以客观比较的问题。`;
    case "planning":
      return `这篇论文想解决的是 ${topicLabel} 场景里决策链路长、步骤容易失稳，系统很难持续完成任务的问题。`;
    case "system":
      return `这篇论文想解决的是 ${topicLabel} 任务中感知、推理、执行模块彼此割裂，整体链路不够顺的问题。`;
    case "policy":
      return `这篇论文想解决的是 ${topicLabel} 任务里 ${focusDetailLabel || "动作生成与控制"} 这一步过于依赖粗糙映射，导致执行效率和稳定性不足的问题。`;
    case "observation":
      return `这篇论文想解决的是 ${topicLabel} 任务里观测信息噪声大、状态表示不稳定，后续推理和执行容易被拖垮的问题。`;
    case "simulation":
      return `这篇论文想解决的是 ${topicLabel} 方向真实试错成本高、验证周期长，方法很难快速迭代的问题。`;
    case "model":
    default:
      return `这篇论文想解决的是 ${topicLabel} 任务里关键能力不够稳定、难以复现和继续工程化的问题。`;
  }
}

function buildMethodSentence(
  topicLabel: string,
  focus: FocusCategory,
  artifactLabel: string,
  paperHandle: string,
  focusDetailLabel = "",
) {
  const namedArtifact = paperHandle ? `把 “${paperHandle}” 做成一套 ${artifactLabel}` : `提出了一套 ${artifactLabel}`;

  switch (focus) {
    case "benchmark":
      return paperHandle
        ? `方法上，它更像是在围绕 ${topicLabel} 打造 “${paperHandle}” 这套 ${artifactLabel}，把任务、指标和对比流程整理成统一入口。`
        : `方法上，它更像是在搭建一套围绕 ${topicLabel} 的 ${artifactLabel}，把任务、指标和对比流程整理成统一入口。`;
    case "planning":
      return `方法上，它${namedArtifact}，把长链路任务拆成更清晰、可组合的决策步骤。`;
    case "system":
      return paperHandle
        ? `方法上，它把 “${paperHandle}” 组织成一套 ${artifactLabel}，重新梳理感知、推理和执行之间的接口，让整条链路更容易协同。`
        : `方法上，它通过 ${artifactLabel} 重新组织感知、推理和执行之间的接口，让整条链路更容易协同。`;
    case "policy":
      return paperHandle
        ? `方法上，它围绕 “${paperHandle}” 把 ${focusDetailLabel || "动作生成与控制"} 做成一套更直接面向执行的 ${artifactLabel}，尽量缩短理解到动作之间的距离。`
        : `方法上，它把 ${focusDetailLabel || "核心能力"} 落成一套更直接面向执行的 ${artifactLabel}，尽量缩短理解到动作之间的距离。`;
    case "observation":
      return paperHandle
        ? `方法上，它围绕 “${paperHandle}” 重点处理 ${artifactLabel}，先把环境信息整理成更稳定的中间表示，再交给上层决策。`
        : `方法上，它重点处理 ${artifactLabel}，先把环境信息整理成更稳定的中间表示，再交给上层决策。`;
    case "simulation":
      return paperHandle
        ? `方法上，它通过 “${paperHandle}” 这类 ${artifactLabel} 先做预测或离线验证，再把结果反馈到真实任务流程里。`
        : `方法上，它通过 ${artifactLabel} 先做预测或离线验证，再把结果反馈到真实任务流程里。`;
    case "model":
    default:
      return paperHandle
        ? `方法上，它围绕 “${paperHandle}” 这条路线构建 ${artifactLabel}，试图把 ${topicLabel} 里的抽象问题落成更清晰的技术路径。`
        : `方法上，它提出了一个围绕 ${topicLabel} 的 ${artifactLabel}，试图把抽象问题落成更清晰的技术路径。`;
  }
}

function buildContributionSentence(
  focus: FocusCategory,
  artifactLabel: string,
  hasCode: boolean,
  relatedRepoCount: number,
) {
  let base = "";

  switch (focus) {
    case "benchmark":
      base = `核心贡献是把 ${artifactLabel} 变成可比较、可复现的研究入口，后续横向评测会更直接。`;
      break;
    case "planning":
      base = `核心贡献是把规划问题沉淀成更通用的基础模块，后续可以复用到不同任务链路里。`;
      break;
    case "system":
      base = `核心贡献是把原本松散的模块关系收敛成一个更可复用的系统方案，方便继续接实现。`;
      break;
    case "policy":
      base = `核心贡献是把抽象任务落成可执行的核心策略，让研究结果更接近真实运行链路。`;
      break;
    case "observation":
      base = `核心贡献是把观测与状态表示做成更稳定的中间层，为后续推理和行动提供更可靠输入。`;
      break;
    case "simulation":
      base = `核心贡献是提供了更低成本的验证入口，让方法可以先在可控环境里快速迭代。`;
      break;
    case "model":
    default:
      base = `核心贡献是给出一条更清晰的 ${artifactLabel} 路线，把问题从概念层推进到可继续验证的方案层。`;
      break;
  }

  if (hasCode) {
    return `${base} 同时已有代码入口，后续复现门槛更低。`;
  }

  if (relatedRepoCount > 0) {
    return `${base} 同时已经关联到实现仓库，便于继续往工程侧下钻。`;
  }

  return `${base} 当前主要价值在于提供新的研究切口和问题拆解方式。`;
}

export function buildPaperExplanationZh(input: PaperNarrativeInput): PaperExplanationView {
  const sourceText = compactText(input.contentRaw ?? input.abstractRaw);
  const haystack = `${input.paperTitle} ${sourceText}`.toLowerCase();
  const focus = getFocusDescriptor(input.paperTitle, sourceText);
  const topicLabel = getTopicLabel(haystack, input.eventTag, focus.category);
  const relatedRepoCount = input.relatedRepoCount ?? 0;
  const paperHandle = getPaperHandle(input.paperTitle, sourceText);
  const focusDetailLabel = focus.category === "policy" ? getPolicyExecutionLabel(haystack) : "";
  const problem = buildProblemSentence(topicLabel, focus.category, focusDetailLabel);
  const method = buildMethodSentence(topicLabel, focus.category, focus.artifactLabel, paperHandle, focusDetailLabel);
  const contribution = buildContributionSentence(focus.category, focus.artifactLabel, input.hasCode, relatedRepoCount);
  const lead = clampPlainText(
    [problem, method.replace(/^方法上，/, "")].join(" "),
    120,
  );

  return {
    lead,
    problem,
    method,
    contribution,
  };
}

export function buildPaperTopicView(input: Pick<PaperNarrativeInput, "paperTitle" | "contentRaw" | "abstractRaw" | "eventTag">): PaperTopicView {
  const sourceText = compactText(input.contentRaw ?? input.abstractRaw);
  const haystack = `${input.paperTitle} ${sourceText}`.toLowerCase();
  const focus = getFocusDescriptor(input.paperTitle, sourceText);
  const detectedTopicLabels = TOPIC_RULES.filter((rule) => hasAnyKeyword(haystack, rule.keywords)).map((rule) => rule.label);
  const topic = getTopicLabel(haystack, input.eventTag, focus.category).split("与")[0] ?? getTagTopicLabel(input.eventTag);
  const keywords = uniqueStrings([
    topic,
    focus.artifactLabel !== "方法框架" ? focus.artifactLabel : "",
    ...detectedTopicLabels,
    getTagTopicLabel(input.eventTag),
  ]).slice(0, 4);

  return {
    topic,
    keywords,
  };
}
