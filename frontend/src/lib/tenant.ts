/**
 * Tenant resolution and context utilities for Restrova multi-tenancy.
 * Supports subdomain extraction, custom domains, and query parameter overrides in development.
 */

export const DEFAULT_TENANT_SLUG = "restrova-default";

export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  custom_domain?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
  hero_image_url?: string | null;
  hero_video_url?: string | null;
  tagline?: string | null;
  about_text?: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  google_maps_url?: string | null;
  reservation_closed_weekdays: string;
  reservation_open_time: string;
  reservation_last_slot_time: string;
  deposit_per_guest: number;
  merchant_upi_id?: string | null;
  merchant_name?: string | null;
  razorpay_key_id?: string | null;
  allow_online_payments: boolean;
  plan_tier: string;
  subscription_status: string;
}

export function getTenantSlug(): string {
  if (typeof window === "undefined") {
    return DEFAULT_TENANT_SLUG;
  }

  // 1. Primary: Subdomain resolution (e.g. "luna.restrova.com" or "luna.localhost")
  const host = window.location.hostname.toLowerCase();
  if (host.includes(".restrova.com")) {
    const sub = host.split(".restrova.com")[0];
    if (sub && !["www", "api", "app", "demo", "status"].includes(sub)) {
      return sub;
    }
  }

  if (host.includes(".localhost")) {
    const sub = host.split(".localhost")[0];
    if (sub && !["www", "api", "app", "demo"].includes(sub)) {
      return sub;
    }
  }

  // 2. Query param ?tenant=... (explicit override for testing and direct previews)
  const params = new URLSearchParams(window.location.search);
  const qSlug = params.get("tenant");
  if (qSlug && qSlug.trim()) {
    return qSlug.trim().toLowerCase();
  }

  return DEFAULT_TENANT_SLUG;
}

export function setTenantSlug(slug: string): void {
  if (typeof window === "undefined") return;
  const clean = slug.trim().toLowerCase();
  try {
    localStorage.setItem("restrova_active_tenant", clean);
    document.cookie = `restrova_tenant=${clean}; path=/; max-age=2592000; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export function withTenantHeaders(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers || {});
  if (!headers.has("X-Tenant-Slug")) {
    headers.set("X-Tenant-Slug", getTenantSlug());
  }
  return { ...init, headers };
}

export async function fetchWithTenant(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const configuredInit = withTenantHeaders(init);
  return fetch(input, configuredInit);
}
