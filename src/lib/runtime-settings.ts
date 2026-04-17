import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { getLlmProviderDefinition, llmProviders, type LlmProviderDraftInput, type LlmProviderId } from "@/lib/llm-providers";

const LlmProviderSettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const RuntimeSettingsSchema = z
  .object({
    tavilyApiKey: z.string().optional(),
    llmProviders: z.record(z.string(), LlmProviderSettingsSchema).optional(),
  })
  .catchall(z.unknown());

type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
type SavedLlmProviderSettings = z.infer<typeof LlmProviderSettingsSchema>;

export type TavilySettingsSnapshot = {
  configured: boolean;
  source: "saved" | "env" | "none";
  preview: string | null;
};

export type RuntimeSecretSource = "saved" | "env" | "none";
export type RuntimeValueSource = "saved" | "env" | "default" | "none";

export type LlmProviderRuntimeConfig = {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  saved: boolean;
  apiKey: string;
  apiKeySource: RuntimeSecretSource;
  baseUrl: string;
  baseUrlSource: RuntimeValueSource;
  model: string;
  modelSource: RuntimeValueSource;
};

export type LlmProviderSettingsSnapshot = {
  id: LlmProviderId;
  label: string;
  description: string;
  badge: string;
  runtimeReady: boolean;
  configured: boolean;
  saved: boolean;
  apiKeySource: RuntimeSecretSource;
  preview: string | null;
  baseUrl: string;
  baseUrlSource: RuntimeValueSource;
  model: string;
  modelSource: RuntimeValueSource;
  envAliases: {
    apiKey: readonly string[];
    baseUrl: readonly string[];
    model: readonly string[];
  };
};

function getSettingsFilePath() {
  return process.env.EVENT2PEOPLE_SETTINGS_PATH ?? path.join(process.cwd(), ".local", "settings.json");
}

async function readRuntimeSettingsFile(): Promise<RuntimeSettings> {
  try {
    const file = await readFile(getSettingsFilePath(), "utf8");
    const parsed = JSON.parse(file);
    const result = RuntimeSettingsSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch (error) {
    if ("code" in (error as Record<string, unknown>) && (error as { code?: string }).code === "ENOENT") {
      return {};
    }

    const message = error instanceof Error ? error.message : "";

    if (/JSON/.test(message)) {
      return {};
    }

    throw error;
  }
}

async function writeRuntimeSettingsFile(settings: RuntimeSettings) {
  const filePath = getSettingsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function readFirstEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function maskSecret(secret: string) {
  if (!secret) {
    return null;
  }

  if (secret.length <= 8) {
    return "••••";
  }

  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function trimValue(value: string | undefined) {
  return value?.trim() ?? "";
}

function sanitizeSavedLlmProviderSettings(input: SavedLlmProviderSettings | LlmProviderDraftInput | undefined) {
  const apiKey = trimValue(input?.apiKey);
  const baseUrl = trimValue(input?.baseUrl);
  const model = trimValue(input?.model);

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
  };
}

function pickSecretValue(savedValue: string | undefined, envKeys: readonly string[]) {
  const normalizedSaved = trimValue(savedValue);

  if (normalizedSaved) {
    return {
      value: normalizedSaved,
      source: "saved" as const,
    };
  }

  const envValue = readFirstEnvValue(envKeys);

  if (envValue) {
    return {
      value: envValue,
      source: "env" as const,
    };
  }

  return {
    value: "",
    source: "none" as const,
  };
}

function pickValue(savedValue: string | undefined, envKeys: readonly string[], fallbackValue?: string) {
  const normalizedSaved = trimValue(savedValue);

  if (normalizedSaved) {
    return {
      value: normalizedSaved,
      source: "saved" as const,
    };
  }

  const envValue = readFirstEnvValue(envKeys);

  if (envValue) {
    return {
      value: envValue,
      source: "env" as const,
    };
  }

  const normalizedFallback = trimValue(fallbackValue);

  if (normalizedFallback) {
    return {
      value: normalizedFallback,
      source: "default" as const,
    };
  }

  return {
    value: "",
    source: "none" as const,
  };
}

function resolveLlmProviderConfig(settings: RuntimeSettings, providerId: LlmProviderId): LlmProviderRuntimeConfig {
  const definition = getLlmProviderDefinition(providerId);
  const savedSettings = sanitizeSavedLlmProviderSettings(settings.llmProviders?.[providerId]);
  const apiKey = pickSecretValue(savedSettings.apiKey, definition.envAliases.apiKey);
  const baseUrl = pickValue(savedSettings.baseUrl, definition.envAliases.baseUrl);
  const model = pickValue(savedSettings.model, definition.envAliases.model, definition.defaultModel);

  return {
    id: definition.id,
    label: definition.label,
    configured: Boolean(apiKey.value),
    saved: Object.keys(savedSettings).length > 0,
    apiKey: apiKey.value,
    apiKeySource: apiKey.source,
    baseUrl: baseUrl.value,
    baseUrlSource: baseUrl.source,
    model: model.value,
    modelSource: model.source,
  };
}

function toLlmProviderSettingsSnapshot(
  settings: RuntimeSettings,
  providerId: LlmProviderId,
): LlmProviderSettingsSnapshot {
  const definition = getLlmProviderDefinition(providerId);
  const runtime = resolveLlmProviderConfig(settings, providerId);

  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    badge: definition.badge,
    runtimeReady: definition.runtimeReady,
    configured: runtime.configured,
    saved: runtime.saved,
    apiKeySource: runtime.apiKeySource,
    preview: maskSecret(runtime.apiKey),
    baseUrl: runtime.baseUrl,
    baseUrlSource: runtime.baseUrlSource,
    model: runtime.model,
    modelSource: runtime.modelSource,
    envAliases: definition.envAliases,
  };
}

function readEnvTavilyApiKey() {
  return process.env.TAVILY_API_KEY?.trim() ?? "";
}

export async function getRuntimeSettings() {
  return readRuntimeSettingsFile();
}

export async function getTavilyApiKey() {
  const settings = await readRuntimeSettingsFile();
  return settings.tavilyApiKey?.trim() || readEnvTavilyApiKey();
}

export async function getTavilySettingsSnapshot(): Promise<TavilySettingsSnapshot> {
  const settings = await readRuntimeSettingsFile();
  const savedKey = settings.tavilyApiKey?.trim() ?? "";

  if (savedKey) {
    return {
      configured: true,
      source: "saved",
      preview: maskSecret(savedKey),
    };
  }

  const envKey = readEnvTavilyApiKey();

  if (envKey) {
    return {
      configured: true,
      source: "env",
      preview: maskSecret(envKey),
    };
  }

  return {
    configured: false,
    source: "none",
    preview: null,
  };
}

export async function saveTavilyApiKey(apiKey: string) {
  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    throw new Error("Tavily API Key 不能为空");
  }

  const settings = await readRuntimeSettingsFile();
  await writeRuntimeSettingsFile({
    ...settings,
    tavilyApiKey: trimmedKey,
  });
}

export async function clearTavilyApiKey() {
  const settings = await readRuntimeSettingsFile();

  if (!("tavilyApiKey" in settings)) {
    return;
  }

  const nextSettings = { ...settings };
  delete nextSettings.tavilyApiKey;
  await writeRuntimeSettingsFile(nextSettings);
}

export async function getLlmProviderRuntimeConfig(providerId: LlmProviderId) {
  const settings = await readRuntimeSettingsFile();
  return resolveLlmProviderConfig(settings, providerId);
}

export async function getLlmProviderSettingsSnapshot(providerId: LlmProviderId) {
  const settings = await readRuntimeSettingsFile();
  return toLlmProviderSettingsSnapshot(settings, providerId);
}

export async function getAllLlmProviderSettingsSnapshots() {
  const settings = await readRuntimeSettingsFile();
  return llmProviders.map((provider) => toLlmProviderSettingsSnapshot(settings, provider.id));
}

export async function saveLlmProviderSettings(providerId: LlmProviderId, input: LlmProviderDraftInput) {
  const nextProviderSettings = sanitizeSavedLlmProviderSettings(input);

  if (Object.keys(nextProviderSettings).length === 0) {
    throw new Error("至少填写一个字段");
  }

  const settings = await readRuntimeSettingsFile();

  await writeRuntimeSettingsFile({
    ...settings,
    llmProviders: {
      ...(settings.llmProviders ?? {}),
      [providerId]: nextProviderSettings,
    },
  });
}

export async function clearLlmProviderSettings(providerId: LlmProviderId) {
  const settings = await readRuntimeSettingsFile();

  if (!settings.llmProviders?.[providerId]) {
    return;
  }

  const nextProviders = { ...(settings.llmProviders ?? {}) };
  delete nextProviders[providerId];

  const nextSettings = {
    ...settings,
    ...(Object.keys(nextProviders).length > 0 ? { llmProviders: nextProviders } : {}),
  };

  if (Object.keys(nextProviders).length === 0) {
    delete nextSettings.llmProviders;
  }

  await writeRuntimeSettingsFile(nextSettings);
}
