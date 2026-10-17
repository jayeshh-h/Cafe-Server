"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer, ArrowLeft, QrCode, Sparkles, Building } from "lucide-react";
import Link from "next/link";
import { useTenantProfile } from "@/components/TenantThemeProvider";
import { getTenantSlug, withTenantHeaders } from "@/lib/tenant";

interface TableItem {
  table_id: number;
  table_number: string;
  capacity: number;
  qr_token: string;
  order_url: string;
  qrDataUrl?: string;
}

export default function QrCardsPage() {
  const { tenant } = useTenantProfile();
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }

    const loadTables = async () => {
      try {
        const slug = getTenantSlug();
        const res = await fetch("/api/v1/tenants/tables/qr-overview", withTenantHeaders());
        if (res.ok) {
          const data: TableItem[] = await res.json();

          // Generate QR code data URLs
          const withQrs = await Promise.all(
            data.map(async (t) => {
              const fullUrl = `${window.location.origin}/table/${t.qr_token}?tenant=${slug}`;
              const qrDataUrl = await QRCode.toDataURL(fullUrl, {
                width: 320,
                margin: 1.5,
                color: {
                  dark: tenant?.primary_color || "#1C1917",
                  light: "#FFFFFF",
                },
              });
              return { ...t, qrDataUrl };
            })
          );
          setTables(withQrs);
        }
      } catch (e) {
        // Handle error
      } finally {
        setLoading(false);
      }
    };

    loadTables();
  }, [tenant]);

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0A08] print:bg-white text-stone-100 print:text-black font-sans flex flex-col justify-between">
      {/* Non-Printable Header */}
      <header className="print:hidden border-b border-stone-800 bg-[#120D0A] px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/pos"
            className="p-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-serif font-bold text-lg text-white">
              {tenant?.name || "Café"} · Table QR Tent Cards
            </h1>
            <p className="text-xs text-stone-400">Print tent cards for your dining tables</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="px-5 py-2.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 font-bold text-xs rounded-xl hover:brightness-110 flex items-center gap-2 shadow-lg transition-all"
        >
          <Printer className="w-4 h-4" /> Print Tent Cards
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {loading ? (
          <div className="py-20 text-center text-stone-400 flex flex-col items-center justify-center gap-2">
            <Sparkles className="w-6 h-6 animate-spin text-[#E8AA62]" />
            <span>Loading table tokens & generating high-res QR codes...</span>
          </div>
        ) : tables.length === 0 ? (
          <div className="py-20 text-center text-stone-400">
            <QrCode className="w-12 h-12 mx-auto text-stone-600 mb-2" />
            <p>No active tables found for this café tenant.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 print:grid-cols-2 print:gap-8">
            {tables.map((t) => (
              <div
                key={t.table_id}
                className="bg-white text-stone-900 border-2 border-stone-300 rounded-3xl p-6 shadow-xl flex flex-col items-center justify-between text-center print:shadow-none print:break-inside-avoid print:border-2 print:border-black min-h-[380px]"
              >
                {/* Tent-Card Top */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-[#C86D51]">
                    Digital Menu & Ordering
                  </span>
                  <h2 className="font-serif font-bold text-2xl text-stone-950">
                    {tenant?.name || "Artisanal Kitchen"}
                  </h2>
                  <p className="text-xs text-stone-500 italic">
                    {tenant?.tagline || "Woodfired Crusts & Specialty Brews"}
                  </p>
                </div>

                {/* QR Code */}
                <div className="my-3 p-3 bg-white rounded-2xl border border-stone-200 shadow-inner flex flex-col items-center">
                  {t.qrDataUrl ? (
                    <img
                      src={t.qrDataUrl}
                      alt={`Table ${t.table_number} QR Code`}
                      className="w-44 h-44 object-contain"
                    />
                  ) : (
                    <div className="w-44 h-44 flex items-center justify-center text-stone-400">
                      Generating...
                    </div>
                  )}
                  <span className="text-[11px] font-semibold text-stone-600 mt-1">
                    Scan with any Camera / UPI App
                  </span>
                </div>

                {/* Table Number Pill */}
                <div className="w-full pt-3 border-t border-stone-200 flex items-center justify-between">
                  <span className="font-serif font-black text-2xl text-stone-950">
                    Table {t.table_number}
                  </span>
                  <div className="text-right">
                    <span className="text-[10px] text-stone-500 block">Seating {t.capacity} Guests</span>
                    <span className="text-[10px] font-mono text-emerald-700 font-semibold block">
                      0% Direct Settlement
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
