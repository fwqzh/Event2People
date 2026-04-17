import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearLlmProviderSettings,
  clearTavilyApiKey,
  getLlmProviderRuntimeConfig,
  getLlmProviderSettingsSnapshot,
  getTavilyApiKey,
  getTavilySettingsSnapshot,
  saveLlmProviderSettings,
  saveTavilyApiKey,
} from "@/lib/runtime-settings";

describe("runtime settings", () => {
  const originalSettingsPath = process.env.EVENT2PEOPLE_SETTINGS_PATH;
  const originalTavilyApiKey = process.env.TAVILY_API_KEY;
  const originalMiniMaxApiKey = process.env.MINIMAX_API_KEY;
  const originalMiniMaxBaseUrl = process.env.MINIMAX_BASE_URL;
  const originalMiniMaxModel = process.env.MINIMAX_MODEL;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "event2people-settings-"));
    process.env.EVENT2PEOPLE_SETTINGS_PATH = path.join(tempDir, "settings.json");
    delete process.env.TAVILY_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_BASE_URL;
    delete process.env.MINIMAX_MODEL;
  });

  afterEach(async () => {
    if (originalSettingsPath) {
      process.env.EVENT2PEOPLE_SETTINGS_PATH = originalSettingsPath;
    } else {
      delete process.env.EVENT2PEOPLE_SETTINGS_PATH;
    }

    if (originalTavilyApiKey) {
      process.env.TAVILY_API_KEY = originalTavilyApiKey;
    } else {
      delete process.env.TAVILY_API_KEY;
    }

    if (originalMiniMaxApiKey) {
      process.env.MINIMAX_API_KEY = originalMiniMaxApiKey;
    } else {
      delete process.env.MINIMAX_API_KEY;
    }

    if (originalMiniMaxBaseUrl) {
      process.env.MINIMAX_BASE_URL = originalMiniMaxBaseUrl;
    } else {
      delete process.env.MINIMAX_BASE_URL;
    }

    if (originalMiniMaxModel) {
      process.env.MINIMAX_MODEL = originalMiniMaxModel;
    } else {
      delete process.env.MINIMAX_MODEL;
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers a saved tavily key over the env fallback", async () => {
    process.env.TAVILY_API_KEY = "env-tavily-key";

    await saveTavilyApiKey("saved-tavily-key");

    expect(await getTavilyApiKey()).toBe("saved-tavily-key");
    expect(await getTavilySettingsSnapshot()).toMatchObject({
      configured: true,
      source: "saved",
    });

    const savedFile = await readFile(process.env.EVENT2PEOPLE_SETTINGS_PATH!, "utf8");
    expect(savedFile).toContain("saved-tavily-key");
  });

  it("falls back to env after clearing the saved tavily key", async () => {
    process.env.TAVILY_API_KEY = "env-tavily-key";

    await saveTavilyApiKey("saved-tavily-key");
    await clearTavilyApiKey();

    expect(await getTavilyApiKey()).toBe("env-tavily-key");
    expect(await getTavilySettingsSnapshot()).toMatchObject({
      configured: true,
      source: "env",
    });
  });

  it("persists OpenAI provider settings locally", async () => {
    await saveLlmProviderSettings("openai", {
      apiKey: "saved-openai-key",
      baseUrl: "https://saved.example/v1",
      model: "gpt-5-mini-local",
    });

    expect(await getLlmProviderRuntimeConfig("openai")).toMatchObject({
      configured: true,
      apiKey: "saved-openai-key",
      apiKeySource: "saved",
      baseUrl: "https://saved.example/v1",
      baseUrlSource: "saved",
      model: "gpt-5-mini-local",
      modelSource: "saved",
    });

    expect(await getLlmProviderSettingsSnapshot("openai")).toMatchObject({
      configured: true,
      apiKeySource: "saved",
      baseUrl: "https://saved.example/v1",
      baseUrlSource: "saved",
      model: "gpt-5-mini-local",
      modelSource: "saved",
    });

    const savedFile = await readFile(process.env.EVENT2PEOPLE_SETTINGS_PATH!, "utf8");
    expect(savedFile).toContain("saved-openai-key");
    expect(savedFile).toContain("gpt-5-mini-local");
  });

  it("falls back to env provider settings after clearing local config", async () => {
    process.env.MINIMAX_API_KEY = "env-minimax-key";
    process.env.MINIMAX_BASE_URL = "https://env.minimax.example/v1";
    process.env.MINIMAX_MODEL = "minimax-env-model";

    await saveLlmProviderSettings("minimax", {
      apiKey: "saved-minimax-key",
      baseUrl: "https://saved.minimax.example/v1",
      model: "minimax-local-model",
    });
    await clearLlmProviderSettings("minimax");

    expect(await getLlmProviderRuntimeConfig("minimax")).toMatchObject({
      configured: true,
      apiKey: "env-minimax-key",
      apiKeySource: "env",
      baseUrl: "https://env.minimax.example/v1",
      baseUrlSource: "env",
      model: "minimax-env-model",
      modelSource: "env",
    });

    expect(await getLlmProviderSettingsSnapshot("minimax")).toMatchObject({
      configured: true,
      apiKeySource: "env",
      baseUrlSource: "env",
      modelSource: "env",
    });
  });
});
