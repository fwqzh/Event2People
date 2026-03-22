import { NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-session";
import { prisma } from "@/lib/prisma";
import { runRefresh } from "@/lib/refresh";

export async function POST() {
  const authorized = await isAdminAuthorized();

  if (!authorized) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const run = await runRefresh(prisma, "manual");

    return NextResponse.json({
      ok: true,
      message: run.message ?? "刷新完成",
      runId: run.id,
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
