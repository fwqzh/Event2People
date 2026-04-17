export const LLM_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "kimi",
  "minimax",
  "deepseek",
  "qwen",
  "doubao",
  "gemini",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export type LlmProviderDefinition = {
  id: LlmProviderId;
  label: string;
  description: string;
  badge: string;
  runtimeReady: boolean;
  apiKeyPlaceholder: string;
  baseUrlPlaceholder: string;
  modelPlaceholder: string;
  defaultModel?: string;
  envAliases: {
    apiKey: readonly string[];
    baseUrl: readonly string[];
    model: readonly string[];
  };
};

export type LlmProviderDraftInput = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export const llmProviders: readonly LlmProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT 系列与 OpenAI Responses API。当前项目现有 AI 富化流程会直接读取这里保存的 OpenAI 配置。",
    badge: "当前项目已接通",
    runtimeReady: true,
    apiKeyPlaceholder: "输入 OpenAI API Key",
    baseUrlPlaceholder: "可选：OpenAI 兼容网关地址",
    modelPlaceholder: "如 gpt-5-mini",
    defaultModel: "gpt-5-mini",
    envAliases: {
      apiKey: ["OPENAI_API_KEY"],
      baseUrl: ["OPENAI_BASE_URL"],
      model: ["OPENAI_MODEL"],
    },
  },
  {
    id: "anthropic",
    label: "Claude",
    description: "Anthropic Claude 系列。适合先统一保存密钥、模型名和代理地址，后续接入调用链时可直接复用。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 Claude / Anthropic API Key",
    baseUrlPlaceholder: "可选：代理或网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
      baseUrl: ["ANTHROPIC_BASE_URL", "CLAUDE_BASE_URL"],
      model: ["ANTHROPIC_MODEL", "CLAUDE_MODEL"],
    },
  },
  {
    id: "kimi",
    label: "Kimi",
    description: "Moonshot / Kimi 系列模型。适合统一保存 API Key、兼容网关地址与默认模型。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 Kimi / Moonshot API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      baseUrl: ["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
      model: ["MOONSHOT_MODEL", "KIMI_MODEL"],
    },
  },
  {
    id: "minimax",
    label: "MiniMax",
    description: "MiniMax 文本与多模态模型，适合在项目里做国内模型统一配置占位。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 MiniMax API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["MINIMAX_API_KEY"],
      baseUrl: ["MINIMAX_BASE_URL"],
      model: ["MINIMAX_MODEL"],
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek 推理与通用模型，适合统一保存 API 配置，后续接入分析或富化链路。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 DeepSeek API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["DEEPSEEK_API_KEY"],
      baseUrl: ["DEEPSEEK_BASE_URL"],
      model: ["DEEPSEEK_MODEL"],
    },
  },
  {
    id: "qwen",
    label: "Qwen",
    description: "通义千问 / DashScope。适合保存阿里云侧模型接入参数，统一放到本地设置里。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 Qwen / DashScope API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
      baseUrl: ["DASHSCOPE_BASE_URL", "QWEN_BASE_URL"],
      model: ["DASHSCOPE_MODEL", "QWEN_MODEL"],
    },
  },
  {
    id: "doubao",
    label: "Doubao",
    description: "豆包 / 火山方舟。适合统一保存方舟或代理网关所需的 API 参数。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 Doubao / Ark API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["ARK_API_KEY", "DOUBAO_API_KEY"],
      baseUrl: ["ARK_BASE_URL", "DOUBAO_BASE_URL"],
      model: ["ARK_MODEL", "DOUBAO_MODEL"],
    },
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini 系列，适合先保存 API Key 与默认模型，给后续多 Provider 接入留入口。",
    badge: "统一保存入口",
    runtimeReady: false,
    apiKeyPlaceholder: "输入 Gemini API Key",
    baseUrlPlaceholder: "可选：代理或兼容网关地址",
    modelPlaceholder: "填写你实际使用的模型 ID",
    envAliases: {
      apiKey: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
      baseUrl: ["GEMINI_BASE_URL", "GOOGLE_GENERATIVE_AI_BASE_URL"],
      model: ["GEMINI_MODEL", "GOOGLE_GENERATIVE_AI_MODEL"],
    },
  },
] as const;

export function getLlmProviderDefinition(providerId: LlmProviderId) {
  const provider = llmProviders.find((item) => item.id === providerId);

  if (!provider) {
    throw new Error(`Unknown LLM provider: ${providerId}`);
  }

  return provider;
}
