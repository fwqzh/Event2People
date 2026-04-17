import { NextResponse } from "next/server";
import { z } from "zod";

import { getLlmProviderDefinition, LLM_PROVIDER_IDS } from "@/lib/llm-providers";
import {
  clearLlmProviderSettings,
  getAllLlmProviderSettingsSnapshots,
  saveLlmProviderSettings,
} from "@/lib/runtime-settings";

const LlmProviderSchema = z.enum(LLM_PROVIDER_IDS);

const LlmSettingsInputSchema = z.object({
  providerId: LlmProviderSchema,
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const LlmSettingsClearSchema = z.object({
  providerId: LlmProviderSchema,
});

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      settings: await getAllLlmProviderSettingsSnapshots(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "设置读取失败",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = LlmSettingsInputSchema.parse(await request.json());
    const provider = getLlmProviderDefinition(payload.providerId);

    await saveLlmProviderSettings(payload.providerId, {
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      model: payload.model,
    });

    return NextResponse.json({
      ok: true,
      message: `${provider.label} 配置已保存`,
      settings: await getAllLlmProviderSettingsSnapshots(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "请求格式不正确",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "设置保存失败",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = LlmSettingsClearSchema.parse(await request.json());
    const provider = getLlmProviderDefinition(payload.providerId);

    await clearLlmProviderSettings(payload.providerId);

    return NextResponse.json({
      ok: true,
      message: `${provider.label} 本地配置已清空`,
      settings: await getAllLlmProviderSettingsSnapshots(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "请求格式不正确",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "设置清空失败",
      },
      { status: 500 },
    );
  }
}
