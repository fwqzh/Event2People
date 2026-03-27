import { NextResponse } from "next/server";

import { getActiveEventAnalysisByStableId } from "@/lib/data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stableId = searchParams.get("stableId");

    if (!stableId) {
      return NextResponse.json({ error: "缺少 stableId" }, { status: 400 });
    }

    const analysis = await getActiveEventAnalysisByStableId(stableId);

    if (!analysis) {
      return NextResponse.json({ error: "事件不存在或暂不支持详细解读" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      analysis,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "详细解读加载失败",
      },
      { status: 500 },
    );
  }
}
