import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearTavilyApiKey, getTavilyApiKey, getTavilySettingsSnapshot, saveTavilyApiKey } from "@/lib/runtime-settings";

describe("runtime settings", () => {
  const originalSettingsPath = process.env.EVENT2PEOPLE_SETTINGS_PATH;
  const originalTavilyApiKey = process.env.TAVILY_API_KEY;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "event2people-settings-"));
    process.env.EVENT2PEOPLE_SETTINGS_PATH = path.join(tempDir, "settings.json");
    delete process.env.TAVILY_API_KEY;
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

  it("falls back to env after clearing the saved key", async () => {
    process.env.TAVILY_API_KEY = "env-tavily-key";

    await saveTavilyApiKey("saved-tavily-key");
    await clearTavilyApiKey();

    expect(await getTavilyApiKey()).toBe("env-tavily-key");
    expect(await getTavilySettingsSnapshot()).toMatchObject({
      configured: true,
      source: "env",
    });
  });
});
