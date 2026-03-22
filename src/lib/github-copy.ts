import { clampPlainText, repoDisplayName, sentenceZh } from "@/lib/text";

type GitHubProjectSource = {
  repoName?: string | null;
  repoDescriptionRaw?: string | null;
  readmeExcerptRaw?: string | null;
};

const GITHUB_HIGHLIGHT_LIMIT = 20;
const GITHUB_CARD_SUMMARY_MIN = 60;
const GITHUB_CARD_SUMMARY_MAX = 80;

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function trimSentenceEnding(value: string) {
  return compactText(value)
    .replace(/(?:\.{3,}|…+)+$/g, "")
    .replace(/[；;，,、：:]+$/g, "");
}

function normalizeSentenceCore(value: string) {
  return trimSentenceEnding(value).replace(/[。！？!?]+$/g, "");
}

function ensureSentenceEndingZh(value: string, limit?: number) {
  const normalized = normalizeSentenceCore(value);

  if (!normalized) {
    return "";
  }

  if (typeof limit === "number" && normalized.length >= limit) {
    const truncated = clampPlainText(normalized, Math.max(0, limit - 1));
    return truncated ? `${truncated}。` : "";
  }

  return `${normalized}。`;
}

function cleanGitHubSourceText(value: string | null | undefined) {
  return compactText(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePurposeZh(value: string) {
  const cleaned = normalizeSentenceCore(value);

  if (!cleaned) {
    return "聚焦前沿技术方向的开源项目";
  }

  if (cleaned.startsWith("这是一个")) {
    return cleaned.slice("这是一个".length);
  }

  if (cleaned.startsWith("用于") || cleaned.startsWith("面向") || cleaned.startsWith("聚焦")) {
    return cleaned;
  }

  return `聚焦${cleaned}的开源项目`;
}

function matchesKeyword(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function getGitHubSummaryExtensionZh(project: GitHubProjectSource, highlight: string) {
  const keywordText = [
    compactText(highlight),
    cleanGitHubSourceText(project.repoDescriptionRaw),
    cleanGitHubSourceText(project.readmeExcerptRaw).slice(0, 220),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    matchesKeyword(
      keywordText,
      /\bclaude code plugin\b|\bplugin\b.*\b(context usage|active tools|running agents|todo progress|shows what'?s happening)\b/,
    )
  ) {
    return "持续展示上下文占用、活跃工具、运行中的 agent 与待办进度";
  }

  if (matchesKeyword(keywordText, /\bminecraft\b|\breal world\b.*\blocation\b/)) {
    return "把真实世界地点以较高细节生成到 Minecraft 场景中";
  }

  if (matchesKeyword(keywordText, /\bpdf\b|\baccessibility\b|\brag\b|\blayout analysis\b|\bstructured data\b/)) {
    return "把 PDF 解析、结构化提取与无障碍处理放进同一条数据处理链路中";
  }

  if (matchesKeyword(keywordText, /\boffline\b|\bsurvival\b|\bmedia archives and data\b/)) {
    return "整合离线工具、知识资料与 AI 能力，服务断网环境下的信息获取与使用";
  }

  if (matchesKeyword(keywordText, /\bsystem and service manager\b|\bsystem\b.*\bservice manager\b/)) {
    return "负责系统启动、服务编排、进程管理与运行时控制";
  }

  if (matchesKeyword(keywordText, /\bbrowser\b|\bweb pilot\b|\btool-use\b/)) {
    return "支持浏览器代理在页面环境中完成工具调用、任务规划与连续操作";
  }

  if (matchesKeyword(keywordText, /\bmultimodal\b|\bvlm\b|\breasoning\b/)) {
    return "支持多模态模型进行规划、推理轨迹记录与结果评测";
  }

  if (matchesKeyword(keywordText, /\bstream(?:ing)?\b|\bobservability\b|\borchestrat(?:ion|e)\b/)) {
    return "覆盖模型流式传输、链路观测、基准评测与编排监控";
  }

  if (matchesKeyword(keywordText, /\bmoney online\b|\bmaking money online\b/)) {
    return "把内容生成、发布分发与变现步骤串成自动化工作流";
  }

  if (matchesKeyword(keywordText, /\bsecurity\b|\bscanner\b|\bscanning\b|\bvulnerab(?:ility|ilities)\b/)) {
    return "覆盖镜像、依赖与漏洞检查等自动化安全扫描环节";
  }

  if (matchesKeyword(keywordText, /\bvoice\b|\bspeech\b/)) {
    return "支持语音识别、对话理解与语音 agent 执行";
  }

  if (matchesKeyword(keywordText, /\bdata interchange\b|\bserialization\b|\bprotocol buffer\b/)) {
    return "负责结构化对象定义、协议转换与跨服务数据交换";
  }

  if (matchesKeyword(keywordText, /\brobot\b|\bembodied\b/)) {
    return "面向机器人与具身任务，连接网页操作、感知理解与动作规划";
  }

  if (matchesKeyword(keywordText, /\beval(?:uation)?\b|\bbenchmark\b/)) {
    return "把实验评测、结果记录与基线对比整合成统一可复用的测试流程";
  }

  return "";
}

function getGitHubExpandedDetailPartsZh(project: GitHubProjectSource, highlight: string) {
  const keywordText = [
    compactText(highlight),
    cleanGitHubSourceText(project.repoDescriptionRaw),
    cleanGitHubSourceText(project.readmeExcerptRaw).slice(0, 220),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    matchesKeyword(
      keywordText,
      /\bclaude code plugin\b|\bplugin\b.*\b(context usage|active tools|running agents|todo progress|shows what'?s happening)\b/,
    )
  ) {
    return [
      "它更像一个持续驻留的状态面板，把上下文占用、当前工具、运行中的 agents 和 todo 进度放在同一视图里，减少来回切换界面的成本",
      "这类项目的重点不是新增一条独立工作流，而是在日常编码过程中持续暴露执行状态，方便你及时判断是否要接管、修正或继续放行",
    ];
  }

  if (matchesKeyword(keywordText, /\bminecraft\b|\breal world\b.*\blocation\b/)) {
    return [
      "项目会根据真实地点数据去重建 Minecraft 场景，重点不只是生成地图，还强调更高细节的环境还原与空间表达",
      "它更像把地理信息、场景生成和环境细节还原串成一条完整流程，而不是只做一个静态世界导出工具",
    ];
  }

  if (matchesKeyword(keywordText, /\bpdf\b|\baccessibility\b|\brag\b|\blayout analysis\b|\bstructured data\b/)) {
    return [
      "仓库重点处理 PDF 到 AI 可用数据的转换，同时覆盖版面解析、结构提取和无障碍自动化，适合放进 RAG 或文档处理链路里",
      "如果你的目标是把原始文档进一步变成可检索、可解析、可继续加工的数据，这类项目会比单纯文本抽取工具更完整",
    ];
  }

  if (matchesKeyword(keywordText, /\boffline\b|\bsurvival\b|\bmedia archives and data\b/)) {
    return [
      "它想解决的是离线条件下的信息与工具可得性，把关键资料、媒介内容和 AI 能力放进一台可脱网使用的终端设备中",
      "核心不是某一个模型功能，而是在断网场景下仍能维持资料查询、内容阅读和基础 AI 处理能力",
    ];
  }

  if (matchesKeyword(keywordText, /\bsystem and service manager\b|\bsystem\b.*\bservice manager\b/)) {
    return [
      "它本质上是系统级的服务管理基础设施，覆盖启动流程、服务生命周期、进程守护和运行时控制这些核心环节",
      "这种项目更偏底层基础设施，价值在于把服务启动、依赖关系、守护策略和运行时控制统一到同一套稳定机制里",
    ];
  }

  if (matchesKeyword(keywordText, /\bbrowser\b|\bweb pilot\b|\btool-use\b/)) {
    return [
      "仓库把页面观察、工具调用、动作执行和循环控制放进同一套 runner 中，更适合需要连续网页操作的 agent 任务",
      "实际使用时，代理可以一边读取网页状态一边决定下一步操作，把多步浏览器任务持续执行到完成，而不是停在单次脚本调用",
    ];
  }

  if (matchesKeyword(keywordText, /\bmultimodal\b|\bvlm\b|\breasoning\b/)) {
    return [
      "它围绕多模态模型的规划、推理轨迹和评测能力搭建统一工作栈，更偏向把推理链路与结果验证放在同一套实现里",
      "更适合那些既要处理图文输入、又希望保留推理过程和评测结果的研究或实验环境",
    ];
  }

  if (matchesKeyword(keywordText, /\bstream(?:ing)?\b|\bobservability\b|\borchestrat(?:ion|e)\b/)) {
    return [
      "仓库覆盖模型流式输出、链路观测、基准评测和编排监控，目标是把执行层工具链组织成更完整的基础设施",
      "重点不是单个模型调用能力，而是把运行链路、观测指标和调试抓手一起纳入基础设施层",
    ];
  }

  if (matchesKeyword(keywordText, /\bmoney online\b|\bmaking money online\b/)) {
    return [
      "它强调把内容生成、发布分发和变现步骤串起来，更像一套面向执行流程的自动化脚本与工作流集合",
      "更接近把想法验证、内容产出和渠道执行接成一条能反复运行的业务自动化链路",
    ];
  }

  if (matchesKeyword(keywordText, /\bsecurity\b|\bscanner\b|\bscanning\b|\bvulnerab(?:ility|ilities)\b/)) {
    return [
      "项目把镜像、依赖和漏洞检查放进统一扫描链路里，更适合作为安全检测、合规检查和交付前置环节的一部分",
      "它通常适合接在开发、构建或交付流程前面，尽量把风险暴露在上线之前",
    ];
  }

  if (matchesKeyword(keywordText, /\bvoice\b|\bspeech\b/)) {
    return [
      "它把语音识别、对话理解和语音 agent 执行放在同一条交互链路里，更偏向可运行的实时语音系统实现",
      "重点在于让语音输入、理解和动作响应形成闭环，而不是只做单点语音识别或转写演示",
    ];
  }

  if (matchesKeyword(keywordText, /\bdata interchange\b|\bserialization\b|\bprotocol buffer\b/)) {
    return [
      "仓库核心在于把结构化对象定义、协议转换和跨服务数据交换放进统一约束下，减少系统间传输的不一致问题",
      "更适合作为多服务系统里的公共数据约束层，降低接口演进时的兼容成本和沟通负担",
    ];
  }

  if (matchesKeyword(keywordText, /\brobot\b|\bembodied\b/)) {
    return [
      "它更接近可执行的具身代理实现，把网页操作、环境感知和动作规划串在一起，服务机器人与真实任务执行场景",
      "重点是把感知、决策和动作真正接进统一执行框架，而不是只展示单一模型效果",
    ];
  }

  if (matchesKeyword(keywordText, /\beval(?:uation)?\b|\bbenchmark\b/)) {
    return [
      "项目重点不是单点模型能力，而是把实验评测、结果记录和基线对比统一起来，方便反复比较与持续迭代",
      "因此它更适合持续实验、对照评测和版本迭代场景，而不是一次性的跑分脚本",
    ];
  }

  const cleanedDescription = cleanGitHubSourceText(project.repoDescriptionRaw);
  const cleanedReadme = cleanGitHubSourceText(project.readmeExcerptRaw);

  if (cleanedDescription && cleanedReadme) {
    return [
      `仓库描述里强调“${clampPlainText(cleanedDescription, 42)}”这类能力`,
      `README 片段也围绕“${clampPlainText(cleanedReadme, 40)}”展开，说明它更偏向可直接落地使用的开源实现，而不是一句概念性介绍`,
    ];
  }

  if (cleanedDescription) {
    return [`仓库描述里强调“${clampPlainText(cleanedDescription, 42)}”这类能力`, "整体看更像把相关能力做成可以直接上手使用的开源实现，而不是停留在概念展示层"];
  }

  if (cleanedReadme) {
    return [`README 片段主要围绕“${clampPlainText(cleanedReadme, 40)}”展开`, "可以看出它更关注实际执行链路和可运行能力，而不只是给出一个很短的项目口号"];
  }

  return [];
}

function appendSummaryClause(summary: string, clause: string) {
  const cleanedClause = normalizeSentenceCore(clause);

  if (!cleanedClause || summary.includes(cleanedClause)) {
    return summary;
  }

  const nextSummary = `${summary}，${cleanedClause}`;
  return nextSummary.length <= GITHUB_CARD_SUMMARY_MAX ? nextSummary : summary;
}

export function looksLikeMalformedGitHubIntro(value: string | null | undefined) {
  const text = compactText(value);

  if (!text) {
    return true;
  }

  if (/https?:\/\/|!\[|```|={3,}|#{2,}|\[[^\]]+\]\([^)]+\)/.test(text)) {
    return true;
  }

  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const asciiChars = (text.match(/[A-Za-z]/g) ?? []).length;
  const asciiRatio = asciiChars / Math.max(text.length, 1);

  if (chineseChars === 0 && (asciiRatio > 0.45 || text.length > 30)) {
    return true;
  }

  return false;
}

export function buildGitHubProjectIntroZh(project: GitHubProjectSource, fallbackTag: string) {
  const text = `${compactText(project.repoDescriptionRaw)} ${compactText(project.readmeExcerptRaw)}`.toLowerCase();

  if (text.includes("browser")) {
    return sentenceZh("用于浏览器工作流的 agent 执行循环。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("data interchange") || text.includes("serialization") || text.includes("protocol buffer")) {
    return sentenceZh("用于结构化数据序列化与交换。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("multimodal") || text.includes("vlm")) {
    return sentenceZh("用于多模态推理与规划的研究栈。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("voice") || text.includes("speech")) {
    return sentenceZh("用于语音交互与规划的 agent 运行时。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("simulation") || text.includes("world model")) {
    return sentenceZh("用于具身模拟与 world model 研究。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("eval") || text.includes("benchmark")) {
    return sentenceZh("用于评测与编排的开源基础设施。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("robot") || text.includes("embodied")) {
    return sentenceZh("用于具身智能任务执行与规划。", GITHUB_HIGHLIGHT_LIMIT);
  }

  if (text.includes("security") || text.includes("scanner") || text.includes("scan")) {
    return sentenceZh("用于容器与依赖安全扫描。", GITHUB_HIGHLIGHT_LIMIT);
  }

  return clampPlainText(`用于${fallbackTag}任务的工具`, GITHUB_HIGHLIGHT_LIMIT);
}

export function buildGitHubCardSummaryZh(
  project: GitHubProjectSource & {
    highlight: string;
  },
) {
  const purpose = normalizePurposeZh(project.highlight);
  const displayName = repoDisplayName(project.repoName ?? "");
  let summary = displayName ? `${displayName} 是一个${purpose}` : `这是一个${purpose}`;

  if (summary.length > GITHUB_CARD_SUMMARY_MAX) {
    return ensureSentenceEndingZh(clampPlainText(summary, GITHUB_CARD_SUMMARY_MAX), GITHUB_CARD_SUMMARY_MAX);
  }

  const contextClauses = [
    getGitHubSummaryExtensionZh(project, project.highlight),
  ];

  for (const clause of contextClauses) {
    summary = appendSummaryClause(summary, clause);

    if (summary.length >= GITHUB_CARD_SUMMARY_MIN) {
      break;
    }
  }

  if (summary.length < GITHUB_CARD_SUMMARY_MIN) {
    return ensureSentenceEndingZh(summary, GITHUB_CARD_SUMMARY_MAX);
  }

  return ensureSentenceEndingZh(summary, GITHUB_CARD_SUMMARY_MAX);
}

export function buildGitHubExpandedIntroZh(
  project: GitHubProjectSource & {
    highlight: string;
    cardSummary: string;
  },
) {
  const parts = [normalizeSentenceCore(project.cardSummary)];
  const detailParts = getGitHubExpandedDetailPartsZh(project, project.highlight);

  for (const detailPart of detailParts) {
    const cleanedDetail = normalizeSentenceCore(detailPart);

    if (!cleanedDetail) {
      continue;
    }

    if (parts.some((part) => part.includes(cleanedDetail) || cleanedDetail.includes(part))) {
      continue;
    }

    parts.push(cleanedDetail);
  }

  return ensureSentenceEndingZh(parts.join("。"));
}
