import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const RuntimeSettingsSchema = z
  .object({
    tavilyApiKey: z.string().optional(),
  })
  .catchall(z.unknown());

type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;

export type TavilySettingsSnapshot = {
  configured: boolean;
  source: "saved" | "env" | "none";
  preview: string | null;
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

function readEnvTavilyApiKey() {
  return process.env.TAVILY_API_KEY?.trim() ?? "";
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
