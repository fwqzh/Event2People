import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRefreshStatus, kickoffRefresh } from "@/lib/refresh";

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

export async function POST() {
  try {
    const result = await kickoffRefresh(prisma, "manual");

    return NextResponse.json({
      ok: true,
      started: result.started,
      message: result.started ? "刷新已开始" : "已有刷新任务正在运行",
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
