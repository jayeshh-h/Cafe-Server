// fetch() for staff portals (owner admin, POS, manager) with 5-hour session expiry and auto-logout.
// Staff logins expire automatically after 5 hours (300 minutes), prompting re-login for security.
import { getTenantSlug } from "./tenant";

export function decodeJwt(token: string): { exp?: number; sub?: string; type?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function isTokenValid(token: string | null): boolean {
  if (!token || typeof token !== "string") return false;
  const payload = decodeJwt(token);
  if (!payload || typeof payload.exp !== "number") return false;
  const now = Math.floor(Date.now() / 1000);
  // Valid if exp is in the future (with 5s buffer)
  return payload.exp > now + 5;
}

export function getTokenRemainingMs(token: string | null): number {
  if (!token || typeof token !== "string") return 0;
  const payload = decodeJwt(token);
  if (!payload || typeof payload.exp !== "number") return 0;
  const remaining = payload.exp * 1000 - Date.now();
  return Math.max(0, remaining);
}

export interface StaffSession {
  tokenKey: string;
  refreshKey: string;
  expiredEvent: string;
  refreshedEvent: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  getValidToken: () => string | null;
  setTokens: (accessToken: string, refreshToken?: string) => void;
  clearSession: () => void;
}

function createStaffSession(prefix: string): StaffSession {
  const tokenKey = `jaadoo_${prefix}_token`;
  const refreshKey = `jaadoo_${prefix}_refresh_token`;
  const expiredEvent = `jaadoo-${prefix}-session-expired`;
  const refreshedEvent = `jaadoo-${prefix}-token-refreshed`;
  let refreshInFlight: Promise<string | null> | null = null;
  let expiryTimer: any = null;

  const clearSession = () => {
    if (typeof window === "undefined") return;
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(refreshKey);
    if (prefix === "pos") {
      localStorage.removeItem("jaadoo_pos_user");
    }
  };

  const scheduleExpiry = (token: string | null) => {
    if (typeof window === "undefined" || !token) return;
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    const msRemaining = getTokenRemainingMs(token);
    if (msRemaining <= 0) {
      clearSession();
      window.dispatchEvent(new Event(expiredEvent));
      return;
    }

    // Set auto-logout timer for the remaining duration of the 5-hour token
    expiryTimer = setTimeout(() => {
      clearSession();
      window.dispatchEvent(new Event(expiredEvent));
    }, msRemaining);
  };

  const setTokens = (accessToken: string, refreshToken?: string) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(tokenKey, accessToken);
    if (refreshToken) {
      localStorage.setItem(refreshKey, refreshToken);
    }
    scheduleExpiry(accessToken);
  };

  const refresh = (): Promise<string | null> => {
    if (typeof window === "undefined") return Promise.resolve(null);
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const refreshToken = localStorage.getItem(refreshKey);
        if (!refreshToken || !isTokenValid(refreshToken)) {
          clearSession();
          window.dispatchEvent(new Event(expiredEvent));
          return null;
        }
        try {
          const res = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Tenant-Slug": getTenantSlug(),
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (!res.ok) {
            clearSession();
            window.dispatchEvent(new Event(expiredEvent));
            return null;
          }
          const data = await res.json();
          setTokens(data.access_token, data.refresh_token);
          window.dispatchEvent(new CustomEvent(refreshedEvent, { detail: data.access_token }));
          return data.access_token as string;
        } catch {
          return null;
        } finally {
          refreshInFlight = null;
        }
      })();
    }
    return refreshInFlight;
  };

  const getValidToken = (): string | null => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(tokenKey);
    if (!stored) return null;

    if (isTokenValid(stored)) {
      scheduleExpiry(stored);
      return stored;
    }

    // Access token expired; if refresh token is still valid within 5-hour window, try refresh
    const refreshToken = localStorage.getItem(refreshKey);
    if (refreshToken && isTokenValid(refreshToken)) {
      refresh().catch(() => {});
      return stored;
    }

    clearSession();
    return null;
  };

  const sessionFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const baseHeaders = new Headers(init.headers);
    if (!baseHeaders.has("X-Tenant-Slug")) {
      baseHeaders.set("X-Tenant-Slug", getTenantSlug());
    }
    const baseInit = { ...init, headers: baseHeaders };

    if (!baseHeaders.has("Authorization")) return fetch(input, baseInit);

    const withToken = (token: string): RequestInit => {
      const h = new Headers(baseHeaders);
      h.set("Authorization", `Bearer ${token}`);
      return { ...baseInit, headers: h };
    };

    const stored = localStorage.getItem(tokenKey);
    if (stored && !isTokenValid(stored)) {
      const fresh = await refresh();
      if (!fresh) {
        clearSession();
        window.dispatchEvent(new Event(expiredEvent));
        return fetch(input, baseInit);
      }
      return fetch(input, withToken(fresh));
    }

    const res = await fetch(input, stored ? withToken(stored) : baseInit);
    if (res.status !== 401) return res;

    const fresh = await refresh();
    if (!fresh) {
      clearSession();
      window.dispatchEvent(new Event(expiredEvent));
      return res;
    }
    return fetch(input, withToken(fresh));
  };

  // Schedule timer on load if token already exists
  if (typeof window !== "undefined") {
    setTimeout(() => {
      const existing = localStorage.getItem(tokenKey);
      if (existing) {
        if (isTokenValid(existing)) {
          scheduleExpiry(existing);
        } else {
          clearSession();
        }
      }
    }, 0);
  }

  return {
    tokenKey,
    refreshKey,
    expiredEvent,
    refreshedEvent,
    fetch: sessionFetch,
    getValidToken,
    setTokens,
    clearSession,
  };
}

export const adminSession = createStaffSession("admin");
export const posSession = createStaffSession("pos");
export const managerSession = createStaffSession("manager");
