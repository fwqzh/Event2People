import { NextResponse } from "next/server";

import { clearAdminCookie } from "@/lib/admin-session";

export async function POST() {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
}
