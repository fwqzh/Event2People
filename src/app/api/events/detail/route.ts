import { NextResponse } from "next/server";

import { getActiveEventDetailByStableId } from "@/lib/data";

export async function GET(request: Request) {
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
}
