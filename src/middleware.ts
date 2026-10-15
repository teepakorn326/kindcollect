import { NextResponse, type NextRequest } from "next/server";

// Basic Auth for the whole app (CLAUDE.md §1). Skipped when credentials are not configured (local dev).
// The Vapi webhook authenticates with VAPI_WEBHOOK_SECRET instead.
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="KindCollect", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demo/|api/vapi/webhook).*)"],
};
