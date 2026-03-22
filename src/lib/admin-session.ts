import { cookies } from "next/headers";

import { env } from "@/lib/env";

const ADMIN_COOKIE = "event2people_admin";

export async function isAdminAuthorized() {
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value === "authorized";
}

export async function setAdminCookie() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "authorized", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearAdminCookie() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

export function verifyAdminSecret(secret: string) {
  return secret === env.adminRefreshSecret;
}
