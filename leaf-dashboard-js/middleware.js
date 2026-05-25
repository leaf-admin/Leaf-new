import { NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Leaf Dashboard Local", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function middleware(request) {
  if (request.nextUrl?.pathname?.startsWith("/api/")) {
    return NextResponse.next();
  }

  const enabled = String(process.env.DASHBOARD_BASIC_AUTH_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    return NextResponse.next();
  }

  const expectedUser = process.env.DASHBOARD_BASIC_AUTH_USER || "";
  const expectedPassword = process.env.DASHBOARD_BASIC_AUTH_PASSWORD || "";
  if (!expectedUser || !expectedPassword) {
    return unauthorized();
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Basic ")) {
    return unauthorized();
  }

  try {
    const encoded = authHeader.slice(6).trim();
    const decoded = atob(encoded);
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return unauthorized();
    }

    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (user !== expectedUser || password !== expectedPassword) {
      return unauthorized();
    }

    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (_) {
    return unauthorized();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
