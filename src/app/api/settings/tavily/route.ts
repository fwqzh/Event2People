import { NextResponse } from "next/server";
import { z } from "zod";

import { clearTavilyApiKey, getTavilySettingsSnapshot, saveTavilyApiKey } from "@/lib/runtime-settings";

const TavilySettingsInputSchema = z.object({
  tavilyApiKey: z.string(),
});

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      settings: await getTavilySettingsSnapshot(),
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
    const payload = TavilySettingsInputSchema.parse(await request.json());
    await saveTavilyApiKey(payload.tavilyApiKey);

    return NextResponse.json({
      ok: true,
      message: "Tavily API Key 已保存",
      settings: await getTavilySettingsSnapshot(),
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

export async function DELETE() {
  try {
    await clearTavilyApiKey();

    return NextResponse.json({
      ok: true,
      message: "本地 Tavily API Key 已清空",
      settings: await getTavilySettingsSnapshot(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "设置清空失败",
      },
      { status: 500 },
    );
  }
}
