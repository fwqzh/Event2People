import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRefreshStatus, kickoffRefresh } from "@/lib/refresh";
import { getRefreshSourceLabel, type RefreshSource } from "@/lib/refresh-progress";

function parseRefreshSource(value: unknown): RefreshSource | undefined {
  return value === "github" || value === "kickstarter" || value === "arxiv" ? value : undefined;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    const snapshot = await getRefreshStatus(prisma, runId);

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "刷新状态获取失败",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    let source: RefreshSource | undefined;

    try {
      const bodyText = await request.text();

      if (bodyText.trim()) {
        const parsedBody = JSON.parse(bodyText) as {
          source?: unknown;
        };
        source = parseRefreshSource(parsedBody.source);

        if (parsedBody.source !== undefined && !source) {
          return NextResponse.json(
            {
              error: "无效的刷新来源",
            },
            { status: 400 },
          );
        }
      }
    } catch {
      return NextResponse.json(
        {
          error: "刷新请求格式不正确",
        },
        { status: 400 },
      );
    }

    const result = await kickoffRefresh(prisma, "manual", source);
    const sourceLabel = getRefreshSourceLabel(source ?? null);
    const message = result.started
      ? source
        ? `${sourceLabel} 刷新已开始`
        : "刷新已开始"
      : source
        ? `已有刷新任务正在运行，${sourceLabel} 刷新暂未启动`
        : "已有刷新任务正在运行";

    return NextResponse.json({
      ok: true,
      started: result.started,
      message,
      runId: result.run.id,
      snapshot: result.snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "刷新失败",
      },
      { status: 500 },
    );
  }
}
