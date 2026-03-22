import { NextResponse } from "next/server";
import { z } from "zod";

import { setAdminCookie, verifyAdminSecret } from "@/lib/admin-session";

const bodySchema = z.object({
  secret: z.string().min(1),
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());

  if (!verifyAdminSecret(body.secret)) {
    return NextResponse.json({ error: "密钥不正确" }, { status: 401 });
  }

  await setAdminCookie();
  return NextResponse.json({ ok: true });
}
