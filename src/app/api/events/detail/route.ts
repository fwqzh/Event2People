import { NextResponse } from "next/server";

import { getActiveEventDetailByStableId } from "@/lib/data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stableId = searchParams.get("stableId");

    if (!stableId) {
      return NextResponse.json({ error: "缺少 stableId" }, { status: 400 });
    }

    const detail = await getActiveEventDetailByStableId(stableId);

    if (!detail) {
      return NextResponse.json({ error: "事件不存在" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      detail,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "详情加载失败",
      },
      { status: 500 },
    );
  }
}
