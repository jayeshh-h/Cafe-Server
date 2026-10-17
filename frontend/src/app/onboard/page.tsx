"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Coffee,
  Pizza,
  UtensilsCrossed,
  Layers,
  QrCode,
  ShieldCheck,
  CreditCard,
  Building,
  Check,
  ExternalLink,
  ChevronRight,
  Copy,
} from "lucide-react";
import Link from "next/link";
import { setTenantSlug } from "@/lib/tenant";

interface SlugCheckResult {
  available: boolean;
  message: string;
}

const PALETTES = [
  {
    name: "Espresso & Ivory",
    primary: "#2B1810",
    secondary: "#F7F4EE",
    accent: "#C86D51",
    desc: "Warm artisanal woods, paper cream & terracotta highlights",
  },
  {
    name: "Royal Amber",
    primary: "#1C1917",
    secondary: "#FFFBEB",
    accent: "#D97706",
    desc: "Luxury dark stone, golden honey & brass accents",
  },
  {
    name: "Tuscan Olive",
    primary: "#1A2518",
    secondary: "#F4F7F2",
    accent: "#4D7C0F",
    desc: "Earthy olive greens, botanical ivory & sage undertones",
  },
  {
    name: "Midnight Indigo",
    primary: "#0F172A",
    secondary: "#F8FAFC",
    accent: "#38BDF8",
    desc: "High-contrast slate black, crisp snow & cyan luminescence",
  },
];

const TEMPLATES = [
  {
    id: "pizzeria",
    title: "Woodfired Pizzeria & Italian Kitchen",
    icon: Pizza,
    items: "Garlic Focaccia, Margherita D.O.P., Quattro Formaggi, Cold Brew, Tiramisu",
    desc: "Complete with 48-hour dough capacity protection & pizza oven scheduling",
  },
  {
    id: "cafe",
    title: "Specialty Coffee & Artisan Bakery",
    icon: Coffee,
    items: "Flat Whites, Spanish Lattes, Fresh Croissants, Avocado Sourdough, Cheesecake",
    desc: "Optimized for fast-paced café counter, roastery batches & table QR ordering",
  },
  {
    id: "bistro",
    title: "Bistro & Fine Casual Dining",
    icon: UtensilsCrossed,
    items: "Wild Mushroom Arancini, Handmade Tagliatelle, Seabass, Botanical Spritz",
    desc: "Multi-course coursing, reservation deposits & sommelier beverage flows",
  },
  {
    id: "blank",
    title: "Custom / Blank Slate",
    icon: Layers,
    items: "Custom starter shell ready for your own menu CSV or manual entry",
    desc: "Start with an empty canvas and build your menu item by item",
  },
];

export default function OnboardPage() {
  const [step, setStep] = useState(1);

  // Form State
  const [cafeName, setCafeName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [tagline, setTagline] = useState("");

  // Branding State
  const [selectedPalette, setSelectedPalette] = useState(PALETTES[0]);
  const [primaryColor, setPrimaryColor] = useState(PALETTES[0].primary);
  const [secondaryColor, setSecondaryColor] = useState(PALETTES[0].secondary);
  const [accentColor, setAccentColor] = useState(PALETTES[0].accent);

  // Space & Tables
  const [tableCount, setTableCount] = useState(8);

  // Concept Template
  const [template, setTemplate] = useState("pizzeria");

  // Payments
  const [merchantUpi, setMerchantUpi] = useState("");
  const [merchantName, setMerchantName] = useState("");

  // Validation & Submission
  const [slugStatus, setSlugStatus] = useState<SlugCheckResult | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [onboardResult, setOnboardResult] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Debounced slug check
  useEffect(() => {
    if (!slug || slug.length < 3) {
      setSlugStatus(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingSlug(true);
      try {
        const res = await fetch(`/api/v1/tenants/check-slug?slug=${encodeURIComponent(slug)}`);
        if (res.ok) {
          const data = await res.json();
          setSlugStatus(data);
        }
      } catch {
        setSlugStatus({ available: true, message: "Valid slug" });
      } finally {
        setIsCheckingSlug(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [slug]);

  // Handle café name typing -> auto-suggest slug
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCafeName(val);
    if (!slug || slug === autoSlug(cafeName)) {
      setSlug(autoSlug(val));
    }
  };

  const autoSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
  };

  const handlePaletteSelect = (pal: typeof PALETTES[0]) => {
    setSelectedPalette(pal);
    setPrimaryColor(pal.primary);
    setSecondaryColor(pal.secondary);
    setAccentColor(pal.accent);
  };

  const handleLaunch = async () => {
    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const payload = {
        name: cafeName.trim(),
        slug: slug.trim().toLowerCase(),
        admin_name: ownerName.trim(),
        admin_email: ownerEmail.trim().toLowerCase(),
        admin_password: ownerPassword,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        tagline: tagline.trim() || undefined,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
        merchant_upi_id: merchantUpi.trim() || undefined,
        merchant_name: merchantName.trim() || cafeName.trim(),
        table_count: tableCount,
        template: template,
      };

      const res = await fetch("/api/v1/tenants/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to provision café instance.");
      }

      const data = await res.json();
      setOnboardResult(data);

      // Store credentials & set active tenant
      setTenantSlug(data.tenant.slug);
      localStorage.setItem("jaadoo_pos_token", data.access_token);
      localStorage.setItem("jaadoo_pos_refresh_token", data.refresh_token);
      localStorage.setItem("jaadoo_admin_token", data.access_token);
      localStorage.setItem("jaadoo_manager_token", data.access_token);
      setStep(6); // Success Step
    } catch (e: any) {
      setErrorMsg(e.message || "An error occurred during onboarding.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 =
    cafeName.trim().length >= 2 &&
    slug.trim().length >= 3 &&
    slugStatus?.available &&
    ownerName.trim().length >= 2 &&
    ownerEmail.includes("@") &&
    ownerPassword.length >= 6;

  return (
    <div className="min-h-screen bg-[#0D0907] text-[#FAF7F2] font-sans flex flex-col justify-between selection:bg-[#C86D51]/30">
      {/* Background ambient luxury lighting */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#C86D51]/15 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 -right-40 w-96 h-96 bg-[#D97706]/10 rounded-full blur-[140px]" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 border-b border-stone-800/80 bg-[#0D0907]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#C86D51] to-[#E8AA62] flex items-center justify-center font-serif font-black text-stone-950 text-lg shadow-lg group-hover:scale-105 transition-transform">
            R
          </div>
          <div>
            <span className="font-serif font-bold text-xl tracking-wide text-white">RESTROVA</span>
            <span className="text-[10px] tracking-widest text-[#E8AA62] uppercase block font-semibold -mt-1">
              SaaS Launchpad
            </span>
          </div>
        </Link>

        {step < 6 && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-stone-400">
            <span>Step {step} of 5</span>
            <div className="w-24 h-1.5 bg-stone-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#C86D51] to-[#E8AA62] transition-all duration-300"
                style={{ width: `${(step / 5) * 100}%` }}
              />
            </div>
          </div>
        )}

        <Link
          href="/"
          className="text-xs text-stone-400 hover:text-white transition-colors"
        >
          Exit to Home
        </Link>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {/* STEP 1: IDENTITY & SUBDOMAIN */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Step 1 / 5</span>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1">
                  Name Your Outlet & Claim Subdomain
                </h1>
                <p className="text-stone-400 text-sm mt-1">
                  Your café will instantly receive its own dedicated digital space, live QR menu, and cloud POS.
                </p>
              </div>

              <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-6 sm:p-8 space-y-5 backdrop-blur-sm shadow-xl">
                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Café / Restaurant Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bella Napoli Pizzeria"
                    value={cafeName}
                    onChange={handleNameChange}
                    className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors text-base"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Subdomain Slug (Unique Web Address) *
                  </label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      placeholder="bellanapoli"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      className="flex-1 px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-l-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors font-mono text-sm"
                    />
                    <span className="bg-stone-800 border border-l-0 border-stone-700 px-4 py-3 rounded-r-xl text-stone-400 text-sm font-mono">
                      .restrova.com
                    </span>
                  </div>

                  <div className="mt-2 text-xs flex items-center gap-1.5 min-h-[20px]">
                    {isCheckingSlug ? (
                      <span className="text-stone-400 animate-pulse">Checking availability...</span>
                    ) : slugStatus ? (
                      slugStatus.available ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {slugStatus.message}
                        </span>
                      ) : (
                        <span className="text-rose-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> {slugStatus.message}
                        </span>
                      )
                    ) : (
                      <span className="text-stone-500">Must be 3-30 lowercase characters.</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-stone-800">
                  <div>
                    <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                      Owner / Master Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Marco Rossi"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                      Master Login Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="owner@bellanapoli.com"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                      Master Password *
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="Minimum 6 characters"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                      Contact Phone
                    </label>
                    <input
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] transition-colors text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!canProceedStep1}
                  onClick={() => setStep(2)}
                  className="px-6 py-3.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 font-semibold rounded-xl flex items-center gap-2 shadow-lg transition-all"
                >
                  Continue to Branding <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: VISUAL BRANDING */}
          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Step 2 / 5</span>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1">
                  Curate Your Visual Palette
                </h1>
                <p className="text-stone-400 text-sm mt-1">
                  Pick a signature aesthetic palette or customize exact brand hex tokens.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PALETTES.map((pal) => (
                  <div
                    key={pal.name}
                    onClick={() => handlePaletteSelect(pal)}
                    className={`cursor-pointer p-5 rounded-2xl border transition-all ${
                      selectedPalette.name === pal.name
                        ? "border-[#E8AA62] bg-stone-900 shadow-xl ring-1 ring-[#E8AA62]"
                        : "border-stone-800 bg-stone-900/40 hover:border-stone-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-serif font-semibold text-white">{pal.name}</span>
                      {selectedPalette.name === pal.name && (
                        <Check className="w-4 h-4 text-[#E8AA62]" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-full border border-stone-700 shadow-inner" style={{ backgroundColor: pal.primary }} />
                      <div className="w-7 h-7 rounded-full border border-stone-700 shadow-inner" style={{ backgroundColor: pal.secondary }} />
                      <div className="w-7 h-7 rounded-full border border-stone-700 shadow-inner" style={{ backgroundColor: pal.accent }} />
                    </div>
                    <p className="text-xs text-stone-400">{pal.desc}</p>
                  </div>
                ))}
              </div>

              {/* Tagline & Address */}
              <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Tagline / One-Line Story
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 48-Hour Slow Fermented Neapolitan Crusts & Mountain Roasts"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Physical Address / City
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 14 Cobblestone Walk, Old Quarter, Downtown"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-6 py-3.5 border border-stone-700 hover:bg-stone-800 text-stone-300 font-semibold rounded-xl flex items-center gap-2 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-6 py-3.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] hover:brightness-110 text-stone-950 font-semibold rounded-xl flex items-center gap-2 shadow-lg transition-all"
                >
                  Configure Tables <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: SPACE & TABLES */}
          {step === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Step 3 / 5</span>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1">
                  Table Layout & QR Generation
                </h1>
                <p className="text-stone-400 text-sm mt-1">
                  How many tables does your dining room seat? We will automatically provision each with an encrypted QR security token.
                </p>
              </div>

              <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-6 sm:p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-stone-300">Dining Table Count:</span>
                  <span className="font-serif font-bold text-3xl text-[#E8AA62]">{tableCount} Tables</span>
                </div>

                <input
                  type="range"
                  min="2"
                  max="30"
                  value={tableCount}
                  onChange={(e) => setTableCount(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-[#E8AA62]"
                />

                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5 pt-4 border-t border-stone-800">
                  {Array.from({ length: tableCount }).map((_, i) => (
                    <div
                      key={i}
                      className="p-3 bg-stone-950/70 border border-stone-800 rounded-xl text-center flex flex-col items-center justify-center gap-1 group hover:border-[#E8AA62] transition-colors"
                    >
                      <QrCode className="w-4 h-4 text-stone-400 group-hover:text-[#E8AA62] transition-colors" />
                      <span className="text-xs font-semibold text-stone-200">T{i + 1}</span>
                      <span className="text-[10px] text-stone-500">{i % 2 === 0 ? "4p" : "2p"}</span>
                    </div>
                  ))}
                </div>

                <div className="p-4 bg-stone-950/60 border border-stone-800/80 rounded-xl flex items-center gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                  <p className="text-xs text-stone-300">
                    Tables are automatically protected with dynamic token rotation to eliminate cross-table ordering tampering and session hijacking.
                  </p>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-6 py-3.5 border border-stone-700 hover:bg-stone-800 text-stone-300 font-semibold rounded-xl flex items-center gap-2 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="px-6 py-3.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] hover:brightness-110 text-stone-950 font-semibold rounded-xl flex items-center gap-2 shadow-lg transition-all"
                >
                  Choose Starter Menu <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 4: CONCEPT & STARTER MENU */}
          {step === 4 && (
            <motion.div
              key="step-4"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Step 4 / 5</span>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1">
                  Select Your Operational Concept
                </h1>
                <p className="text-stone-400 text-sm mt-1">
                  We pre-seed a curated starter menu tailored to your kitchen flow so you can test POS and KOT orders immediately.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TEMPLATES.map((tmpl) => {
                  const Icon = tmpl.icon;
                  const isSelected = template === tmpl.id;
                  return (
                    <div
                      key={tmpl.id}
                      onClick={() => setTemplate(tmpl.id)}
                      className={`cursor-pointer p-6 rounded-2xl border transition-all ${
                        isSelected
                          ? "border-[#E8AA62] bg-stone-900 shadow-xl ring-1 ring-[#E8AA62]"
                          : "border-stone-800 bg-stone-900/40 hover:border-stone-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${isSelected ? "bg-[#E8AA62]/20 text-[#E8AA62]" : "bg-stone-800 text-stone-400"}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <span className="font-serif font-semibold text-white">{tmpl.title}</span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-[#E8AA62]" />}
                      </div>
                      <p className="text-xs text-stone-400 mb-2.5">{tmpl.desc}</p>
                      <div className="p-2.5 bg-stone-950/60 rounded-lg border border-stone-800/80 text-[11px] text-stone-400">
                        <span className="text-stone-300 font-medium">Starter Dishes: </span> {tmpl.items}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-6 py-3.5 border border-stone-700 hover:bg-stone-800 text-stone-300 font-semibold rounded-xl flex items-center gap-2 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="px-6 py-3.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] hover:brightness-110 text-stone-950 font-semibold rounded-xl flex items-center gap-2 shadow-lg transition-all"
                >
                  Setup Direct Payments <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 5: DIRECT PAYMENTS (0% COMMISSION) */}
          {step === 5 && (
            <motion.div
              key="step-5"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Step 5 / 5</span>
                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1">
                  Direct 0% Commission Payments
                </h1>
                <p className="text-stone-400 text-sm mt-1">
                  Restrova never touches your funds. Every guest QR bill payment or table reservation deposit settles directly into your own merchant account.
                </p>
              </div>

              <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-6 sm:p-8 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Merchant UPI VPA (UPI ID)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. bellanapoli@icici or 9876543210@paytm"
                    value={merchantUpi}
                    onChange={(e) => setMerchantUpi(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] text-sm font-mono"
                  />
                  <p className="text-[11px] text-stone-500 mt-1.5">
                    Guests scanning the bill QR on their phone will initiate UPI direct to this address.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider mb-2">
                    Merchant Legal Name (As displayed in UPI app)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Bella Napoli Foods LLP"
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-950/70 border border-stone-700 rounded-xl text-white placeholder-stone-600 focus:outline-none focus:border-[#E8AA62] text-sm"
                  />
                </div>

                <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-semibold text-emerald-300">14-Day Unlimited Free Trial</h4>
                    <p className="text-[11px] text-stone-300 mt-0.5 leading-relaxed">
                      Zero credit card required. Full access to Cloud POS, KDS Kitchen Rail, Dynamic Menu, and Table QR tent-cards for 14 days.
                    </p>
                  </div>
                </div>

                {errorMsg && (
                  <div className="p-4 bg-rose-950/30 border border-rose-900/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setStep(4)}
                  className="px-6 py-3.5 border border-stone-700 hover:bg-stone-800 text-stone-300 font-semibold rounded-xl flex items-center gap-2 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleLaunch}
                  className="px-8 py-3.5 bg-gradient-to-r from-[#C86D51] via-[#E8AA62] to-[#C86D51] hover:brightness-110 disabled:opacity-50 text-stone-950 font-bold rounded-xl flex items-center gap-2 shadow-2xl transition-all text-base"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 animate-spin" /> Provisioning Your Café...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-stone-950" /> Launch My Café Live!
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 6: CONGRATULATIONS & LAUNCH HUB */}
          {step === 6 && onboardResult && (
            <motion.div
              key="step-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8 text-center"
            >
              <div className="inline-flex p-4 rounded-3xl bg-gradient-to-tr from-[#C86D51]/20 to-[#E8AA62]/30 border border-[#E8AA62]/40 shadow-2xl">
                <CheckCircle2 className="w-12 h-12 text-[#E8AA62]" />
              </div>

              <div>
                <h1 className="text-4xl sm:text-5xl font-serif font-bold text-white tracking-tight">
                  Congratulations, {onboardResult.tenant.name}!
                </h1>
                <p className="text-stone-300 text-base mt-2 max-w-xl mx-auto">
                  Your multi-tenant restaurant instance has been successfully provisioned on Restrova with{" "}
                  <span className="text-[#E8AA62] font-semibold">{onboardResult.tables_created} tables</span> and a starter concept menu.
                </p>
              </div>

              {/* Subdomain URL box */}
              <div className="bg-stone-900/80 border border-stone-800 rounded-2xl p-5 max-w-lg mx-auto flex items-center justify-between gap-3">
                <div className="text-left overflow-hidden">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 tracking-wider block">Your Live Address</span>
                  <span className="font-mono text-sm text-[#E8AA62] truncate block">
                    {onboardResult.tenant.slug}.restrova.com
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://${onboardResult.tenant.slug}.restrova.com`);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="px-3.5 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? "Copied" : "Copy"}
                </button>
              </div>

              {/* Instant Portal Links */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
                <Link
                  href={onboardResult.portal_urls.pos}
                  className="p-5 rounded-xl border border-stone-800 bg-stone-900/50 hover:border-[#E8AA62] hover:bg-stone-900 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-semibold text-[#E8AA62] tracking-wider">Cloud POS</span>
                    <ExternalLink className="w-4 h-4 text-stone-500 group-hover:text-[#E8AA62] transition-colors" />
                  </div>
                  <h3 className="font-serif font-bold text-lg text-white mb-1">Open POS Terminal</h3>
                  <p className="text-xs text-stone-400">Seat walk-ins, ring KOT orders, split bills & manage live tables.</p>
                </Link>

                <Link
                  href={onboardResult.portal_urls.kds}
                  className="p-5 rounded-xl border border-stone-800 bg-stone-900/50 hover:border-[#E8AA62] hover:bg-stone-900 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-semibold text-emerald-400 tracking-wider">Kitchen Display</span>
                    <ExternalLink className="w-4 h-4 text-stone-500 group-hover:text-emerald-400 transition-colors" />
                  </div>
                  <h3 className="font-serif font-bold text-lg text-white mb-1">Open KDS Screen</h3>
                  <p className="text-xs text-stone-400">Live order ticker, prep timers, kitchen station routing.</p>
                </Link>

                <Link
                  href={onboardResult.portal_urls.manager}
                  className="p-5 rounded-xl border border-stone-800 bg-stone-900/50 hover:border-[#E8AA62] hover:bg-stone-900 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-semibold text-sky-400 tracking-wider">Executive Suite</span>
                    <ExternalLink className="w-4 h-4 text-stone-500 group-hover:text-sky-400 transition-colors" />
                  </div>
                  <h3 className="font-serif font-bold text-lg text-white mb-1">Manager Analytics</h3>
                  <p className="text-xs text-stone-400">Real-time revenue, item sales velocity, reservation ledger.</p>
                </Link>

                <Link
                  href={onboardResult.portal_urls.storefront}
                  className="p-5 rounded-xl border border-stone-800 bg-stone-900/50 hover:border-[#E8AA62] hover:bg-stone-900 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-semibold text-amber-400 tracking-wider">Customer Portal</span>
                    <ExternalLink className="w-4 h-4 text-stone-500 group-hover:text-amber-400 transition-colors" />
                  </div>
                  <h3 className="font-serif font-bold text-lg text-white mb-1">Customer Home</h3>
                  <p className="text-xs text-stone-400">View public brand page, digital menu & reservation booking.</p>
                </Link>

                {onboardResult.tables && onboardResult.tables[0] && (
                  <Link
                    href={`${onboardResult.tables[0].order_url}?tenant=${onboardResult.tenant.slug}`}
                    className="p-5 rounded-xl border border-stone-800 bg-stone-900/50 hover:border-[#E8AA62] hover:bg-stone-900 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs uppercase font-semibold text-purple-400 tracking-wider">Table 1 QR</span>
                      <ExternalLink className="w-4 h-4 text-stone-500 group-hover:text-purple-400 transition-colors" />
                    </div>
                    <h3 className="font-serif font-bold text-lg text-white mb-1">Test Table QR Scan</h3>
                    <p className="text-xs text-stone-400">Simulate guest scanning table tent card & placing digital orders.</p>
                  </Link>
                )}

                <Link
                  href={`/pos?tenant=${onboardResult.tenant.slug}`}
                  className="p-5 rounded-xl border border-dashed border-[#E8AA62]/60 bg-[#E8AA62]/5 hover:bg-[#E8AA62]/10 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-semibold text-[#E8AA62] tracking-wider">Fast Start</span>
                    <ChevronRight className="w-4 h-4 text-[#E8AA62]" />
                  </div>
                  <h3 className="font-serif font-bold text-lg text-white mb-1">Jump Into POS Now</h3>
                  <p className="text-xs text-stone-300">You are already signed in as {onboardResult.owner_username}.</p>
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-stone-800/80 px-6 py-4 text-center text-xs text-stone-500">
        Restrova Multi-Tenant Restaurant OS · Direct 0% Commission Routing · 14-Day Free Evaluation
      </footer>
    </div>
  );
}
