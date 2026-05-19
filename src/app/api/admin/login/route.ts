import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/config";
import { getAdminUser } from "@/lib/db";
import { makeSession, verifySecret } from "@/lib/security";

export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  const user = await getAdminUser(username);
  if (!user || !verifySecret(String(password ?? ""), user.password_hash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, makeSession(user.username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
