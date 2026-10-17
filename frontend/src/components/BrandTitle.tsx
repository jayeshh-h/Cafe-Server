"use client";

import { useId } from "react";
import { useTenantProfile } from "@/components/TenantThemeProvider";

// Dynamic BrandTitle with golden sparkles; defaults to active tenant or Jaadoo Pizza Project
export default function BrandTitle({
  className = "",
  title,
}: {
  className?: string;
  title?: string;
}) {
  const gradientId = useId();
  const { tenant } = useTenantProfile();
  const displayTitle = title || tenant?.name || "Jaadoo Pizza Project";

  // Strip out font-serif/font-sans overrides to guarantee unified Poppins Bold branding across all portals
  const cleanedClass = className.replace(/font-serif/g, "").replace(/font-sans/g, "");
  return (
    <span className={`relative inline-block whitespace-nowrap font-poppins font-bold ${cleanedClass}`}>
      <svg
        viewBox="0 0 204 174"
        className="pointer-events-none absolute bottom-full left-[1em] -mb-[0.4em] w-[1.2em] h-auto"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#F4C63D" />
            <stop offset="100%" stopColor="#E0962E" />
          </radialGradient>
        </defs>
        <g fill={`url(#${gradientId})`}>
          <path d="M128 6 C135 67.5 145.5 79.8 198 88 C145.5 96.2 135 108.5 128 170 C121 108.5 110.5 96.2 58 88 C110.5 79.8 121 67.5 128 6Z" />
          <path d="M26 6 C28 27 31 31.2 46 34 C31 36.8 28 41 26 62 C24 41 21 36.8 6 34 C21 31.2 24 27 26 6Z" />
          <path d="M62 116 C63.6 135.5 66 139.4 78 142 C66 144.6 63.6 148.5 62 168 C60.4 148.5 58 144.6 46 142 C58 139.4 60.4 135.5 62 116Z" />
        </g>
      </svg>
      {displayTitle}
    </span>
  );
}
