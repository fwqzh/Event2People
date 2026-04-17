import OpenAI from "openai";

import { getLlmProviderRuntimeConfig } from "@/lib/runtime-settings";

export async function getOpenAiRuntimeConfig() {
  const config = await getLlmProviderRuntimeConfig("openai");

  return {
    ...config,
    usesCompatibleChatApi: Boolean(config.baseUrl),
  };
}

export async function getOpenAiClient(options: { timeout: number; maxRetries?: number }) {
  const config = await getOpenAiRuntimeConfig();

  if (!config.apiKey) {
    return {
      client: null,
      config,
    };
  }

  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: options.timeout,
      maxRetries: options.maxRetries ?? 1,
    }),
    config,
  };
}
