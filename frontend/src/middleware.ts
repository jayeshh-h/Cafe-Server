import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const DEFAULT_TENANT_SLUG = "restrova-default";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get("host")?.toLowerCase() || "";
  const searchParams = url.searchParams;

  let tenantSlug = "";

  // 1. Subdomain check (e.g. luna.restrova.com or luna.localhost:3000)
  const cleanHost = host.split(":")[0];
  if (cleanHost.includes(".restrova.com")) {
    const sub = cleanHost.split(".restrova.com")[0];
    if (sub && !["www", "api", "app", "demo", "status"].includes(sub)) {
      tenantSlug = sub;
    }
  } else if (cleanHost.includes(".localhost")) {
    const sub = cleanHost.split(".localhost")[0];
    if (sub && !["www", "api", "app", "demo"].includes(sub)) {
      tenantSlug = sub;
    }
  }

  // 2. Explicit query parameter override (e.g. ?tenant=luna)
  if (!tenantSlug) {
    const qSlug = searchParams.get("tenant");
    if (qSlug && qSlug.trim()) {
      tenantSlug = qSlug.trim().toLowerCase();
    }
  }

  // 3. Default fallback
  if (!tenantSlug) {
    tenantSlug = DEFAULT_TENANT_SLUG;
  }

  // Set header on the request so server components and API routes can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", tenantSlug);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - static media files (svg, png, jpg, jpeg, gif, webp, webm, mp4)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webm|mp4)).*)",
  ],
};
