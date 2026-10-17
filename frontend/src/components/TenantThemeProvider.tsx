"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { getTenantSlug, TenantConfig } from "@/lib/tenant";

interface TenantContextValue {
  tenant: TenantConfig | null;
  loading: boolean;
  slug: string;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  loading: true,
  slug: "restrova-default",
  refreshTenant: async () => {},
});

export function TenantThemeProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState<string>("restrova-default");

  const loadTenant = async () => {
    const currentSlug = getTenantSlug();
    setSlug(currentSlug);
    try {
      const res = await fetch("/api/v1/tenants/current", {
        headers: {
          "X-Tenant-Slug": currentSlug,
        },
      });
      if (res.ok) {
        const data: TenantConfig = await res.json();
        setTenant(data);

        // Inject dynamic brand tokens into CSS root variables
        if (typeof document !== "undefined") {
          const root = document.documentElement;
          if (data.primary_color) root.style.setProperty("--tenant-primary", data.primary_color);
          if (data.secondary_color) root.style.setProperty("--tenant-secondary", data.secondary_color);
          if (data.accent_color) root.style.setProperty("--tenant-accent", data.accent_color);
        }
      }
    } catch (e) {
      // Fallback to default styling
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenant();
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, loading, slug, refreshTenant: loadTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenantProfile() {
  return useContext(TenantContext);
}
