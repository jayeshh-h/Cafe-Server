/**
 * Resolves the backend API upstream URL for Next.js API routes and proxies.
 * In development, defaults to local FastAPI (http://localhost:8000).
 * In staging/production, requires API_UPSTREAM_URL to prevent unsafe routing.
 */
export function getUpstreamUrl(): string {
  const url = process.env.API_UPSTREAM_URL || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");
  return url.replace(/\/$/, "");
}
