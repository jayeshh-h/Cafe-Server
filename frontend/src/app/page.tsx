"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Mail,
  MapPin,
  Leaf,
  Utensils,
  Sparkles,
  ArrowRight,
  Monitor,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  QrCode,
  Layers,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import CinematicBrandIntro from "@/components/CinematicBrandIntro";
import { useTenantProfile } from "@/components/TenantThemeProvider";

export default function Home() {
  const { tenant, slug } = useTenantProfile();
  const [isGetStartedOpen, setIsGetStartedOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"saas" | "cafe">(slug === "restrova-default" ? "saas" : "cafe");

  const cafeTitle = tenant?.name || "Jaadoo Pizza Project";
  const cafeTagline =
    tenant?.tagline ||
    "An artisanal pizza and Italian kitchen hidden deep in the historic lanes of Udaipur Old City, known for handcrafted pizza, passionately curated ingredients, and a warm intimate dining experience.";
  const cafeAddress = tenant?.address || "32 Sitaphal ki gali, Ganesh Ghati, Old City Udaipur";

  return (
    <div className="min-h-screen bg-[#0D0907] text-[#FAF7F2] font-sans flex flex-col justify-between selection:bg-[#C86D51]/30">
      {/* 1.35s Cinematic Brand Opening Sequence */}
      <CinematicBrandIntro />

      {/* Top Multi-Tenant Mode Switcher Banner */}
      <div className="bg-[#150F0B] border-b border-stone-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs z-30 relative">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#E8AA62] animate-pulse" />
          <span className="font-serif font-bold text-white tracking-wide">RESTROVA</span>
          <span className="text-stone-500 hidden sm:inline">•</span>
          <span className="text-stone-400 hidden sm:inline">Multi-Tenant Boutique Restaurant OS</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-stone-900 border border-stone-800 p-0.5 rounded-lg flex items-center">
            <button
              type="button"
              onClick={() => setViewMode("saas")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === "saas"
                  ? "bg-[#E8AA62] text-stone-950 shadow-md"
                  : "text-stone-400 hover:text-white"
              }`}
            >
              🚀 Startup Platform
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cafe")}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === "cafe"
                  ? "bg-[#E8AA62] text-stone-950 shadow-md"
                  : "text-stone-400 hover:text-white"
              }`}
            >
              🍕 Live Café View
            </button>
          </div>

          <Link
            href="/onboard"
            className="px-3.5 py-1 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 font-bold rounded-lg hover:brightness-110 transition-all flex items-center gap-1 shadow-md"
          >
            Launch Café <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* VIEW MODE 1: RESTROVA STARTUP SAAS PLATFORM */}
      {viewMode === "saas" && (
        <div className="flex-1 flex flex-col justify-between">
          {/* Hero Section */}
          <section className="relative px-6 sm:px-12 pt-16 pb-20 max-w-6xl mx-auto w-full text-center">
            {/* Ambient Lighting */}
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#C86D51]/15 rounded-full blur-[140px] pointer-events-none" />

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6 relative z-10"
            >
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-stone-900/80 border border-[#E8AA62]/40 text-[#E8AA62] text-xs font-semibold tracking-wider uppercase shadow-xl">
                <Sparkles className="w-3.5 h-3.5" />
                The Next-Gen Restaurant OS for Boutique Brands
              </div>

              <h1 className="text-4xl sm:text-6xl md:text-7xl font-serif font-extrabold text-white tracking-tight leading-[1.08] max-w-4xl mx-auto">
                Turn Your Café Into an{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E8AA62] via-[#F5D0A9] to-[#C86D51]">
                  Artisanal Digital Experience
                </span>
              </h1>

              <p className="text-stone-300 text-base sm:text-xl font-normal max-w-2xl mx-auto leading-relaxed">
                Woodfired pizza oven dough pacing, encrypted table QR ordering, real-time Kitchen Display (KDS),
                and <strong className="text-white font-semibold">0% commission direct UPI payments</strong> settled
                straight to your bank account.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
                <Link
                  href="/onboard"
                  className="px-8 py-4 bg-gradient-to-r from-[#C86D51] via-[#E8AA62] to-[#C86D51] text-stone-950 font-bold rounded-xl text-base shadow-2xl hover:brightness-110 active:scale-95 transition-all flex items-center gap-2.5"
                >
                  <Sparkles className="w-5 h-5 text-stone-950" />
                  Launch Your Café Free (14 Days)
                </Link>

                <Link
                  href="/demo"
                  className="px-6 py-4 bg-stone-900/90 hover:bg-stone-800 border border-stone-700 text-stone-200 font-bold rounded-xl text-base backdrop-blur-md transition-all flex items-center gap-2"
                >
                  <Smartphone className="w-5 h-5 text-[#E8AA62]" />
                  Try Dual-Screen Sandbox Demo
                </Link>
              </div>

              <div className="flex items-center justify-center gap-6 text-xs text-stone-400 pt-3">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> No credit card required
                </span>
                <span>•</span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#E8AA62]" /> 5-minute setup
                </span>
                <span>•</span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400" /> 0% transaction cuts
                </span>
              </div>
            </motion.div>
          </section>

          {/* Feature Showcase Grid */}
          <section className="px-6 py-12 max-w-6xl mx-auto w-full">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl bg-stone-900/50 border border-stone-800 hover:border-[#E8AA62]/50 transition-all space-y-3">
                <div className="w-10 h-10 rounded-xl bg-[#C86D51]/20 text-[#E8AA62] flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <h3 className="font-serif font-bold text-xl text-white">Table QR Digital Ordering</h3>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Guests scan unique, cryptographically encrypted table tokens from their phone. Orders route directly
                  into the kitchen with zero waiter lag.
                </p>
                <Link
                  href="/demo"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E8AA62] hover:underline pt-2"
                >
                  Test Table 3 QR Scan &rarr;
                </Link>
              </div>

              <div className="p-6 rounded-2xl bg-stone-900/50 border border-stone-800 hover:border-[#E8AA62]/50 transition-all space-y-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-950/60 text-emerald-400 flex items-center justify-center">
                  <Monitor className="w-5 h-5" />
                </div>
                <h3 className="font-serif font-bold text-xl text-white">Cloud POS & KDS Rail</h3>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Full dining floor management, multi-station kitchen routing, split bills, and audible order chimes.
                  Staff sessions protected with 5-hour security timers.
                </p>
                <Link
                  href="/pos"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E8AA62] hover:underline pt-2"
                >
                  Open Live POS Terminal &rarr;
                </Link>
              </div>

              <div className="p-6 rounded-2xl bg-stone-900/50 border border-stone-800 hover:border-[#E8AA62]/50 transition-all space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-950/60 text-amber-400 flex items-center justify-center">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="font-serif font-bold text-xl text-white">Oven & Dough Capacity</h3>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Prevent kitchen bottlenecks by capping daily dough production rules and table reservation slots so
                  your kitchen never gets overwhelmed.
                </p>
                <Link
                  href="/manager"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E8AA62] hover:underline pt-2"
                >
                  View Manager Analytics &rarr;
                </Link>
              </div>
            </div>
          </section>

          {/* Pricing Calculator Section */}
          <section className="px-6 py-12 max-w-5xl mx-auto w-full text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#E8AA62]">Transparent Commercial Plans</span>
            <h2 className="text-3xl sm:text-4xl font-serif font-bold text-white mt-1 mb-8">
              Simple Pricing. Zero Commissions.
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="p-6 rounded-2xl bg-stone-900/40 border border-stone-800 flex flex-col justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-stone-400">Starter</span>
                  <div className="mt-2 mb-4">
                    <span className="font-serif font-bold text-3xl text-white">₹1,499</span>
                    <span className="text-xs text-stone-400"> / month</span>
                  </div>
                  <ul className="space-y-2.5 text-xs text-stone-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Up to 8 Dining Tables
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Cloud POS & Table QR
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Direct 0% UPI Payments
                    </li>
                  </ul>
                </div>
                <Link
                  href="/onboard"
                  className="mt-6 w-full py-2.5 border border-stone-700 hover:border-[#E8AA62] text-white text-center font-semibold rounded-xl text-xs transition-colors block"
                >
                  Start 14-Day Trial
                </Link>
              </div>

              <div className="p-6 rounded-2xl bg-gradient-to-b from-stone-900 to-stone-900/80 border-2 border-[#E8AA62] shadow-2xl flex flex-col justify-between relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[#E8AA62] text-stone-950 font-bold text-[10px] uppercase tracking-wider">
                  Most Popular
                </div>
                <div>
                  <span className="text-xs uppercase font-bold text-[#E8AA62]">Growth</span>
                  <div className="mt-2 mb-4">
                    <span className="font-serif font-bold text-3xl text-white">₹2,999</span>
                    <span className="text-xs text-stone-400"> / month</span>
                  </div>
                  <ul className="space-y-2.5 text-xs text-stone-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Unlimited Dining Tables
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Kitchen Display System (KDS)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Table Reservations & Deposits
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Oven & Dough Capacity Pacing
                    </li>
                  </ul>
                </div>
                <Link
                  href="/onboard"
                  className="mt-6 w-full py-2.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 text-center font-bold rounded-xl text-xs hover:brightness-110 transition-all block shadow-lg"
                >
                  Launch Growth Plan
                </Link>
              </div>

              <div className="p-6 rounded-2xl bg-stone-900/40 border border-stone-800 flex flex-col justify-between">
                <div>
                  <span className="text-xs uppercase font-bold text-stone-400">Enterprise</span>
                  <div className="mt-2 mb-4">
                    <span className="font-serif font-bold text-3xl text-white">Custom</span>
                    <span className="text-xs text-stone-400"> / multi-outlet</span>
                  </div>
                  <ul className="space-y-2.5 text-xs text-stone-300">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Multi-Branch Franchises
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Custom Domain (order.brand.com)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Dedicated Account Manager
                    </li>
                  </ul>
                </div>
                <Link
                  href="/contact"
                  className="mt-6 w-full py-2.5 border border-stone-700 hover:border-white text-stone-300 text-center font-semibold rounded-xl text-xs transition-colors block"
                >
                  Contact Sales
                </Link>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* VIEW MODE 2: LIVE CAFÉ FINE DINING STOREFRONT */}
      {viewMode === "cafe" && (
        <div className="flex-1 flex flex-col justify-between">
          <Navbar showNavigation={false} />

          <header className="relative flex-1 min-h-[calc(100vh-8.5rem)] flex items-center justify-start overflow-hidden mx-3 md:mx-6 my-3 rounded-2xl shadow-2xl border border-[#3A281E]/60 bg-[#120D0A]">
            <motion.div
              initial={{ scale: 1.04, opacity: 0.85 }}
              animate={{ scale: 1.0, opacity: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="absolute inset-0 z-0 overflow-hidden"
            >
              <video
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                poster="/book-table-hero-poster.webp"
                className="w-full h-full object-cover object-center brightness-105 contrast-105"
              >
                <source src="/book-table-hero.webm" type="video/webm" />
                <source src="/book-table-hero.mp4" type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/20" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
            </motion.div>

            <div className="relative z-10 text-left px-6 sm:px-12 md:px-16 py-12 max-w-3xl">
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.5, ease: "easeOut" }}
                className="text-4xl sm:text-6xl md:text-7xl font-serif font-bold text-white tracking-tight leading-[1.06] drop-shadow-2xl"
              >
                {cafeTitle}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.5, ease: "easeOut" }}
                className="mt-5 text-base sm:text-lg md:text-xl font-sans font-normal text-stone-100 max-w-2xl leading-relaxed drop-shadow-md"
              >
                {cafeTagline}
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38, duration: 0.5, ease: "easeOut" }}
                className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 pt-5 border-t border-white/15"
              >
                <Link
                  href="/location"
                  className="inline-flex items-center gap-2 text-stone-200 hover:text-[#E8AA62] text-xs sm:text-sm font-sans font-medium transition-colors group"
                >
                  <MapPin className="w-4 h-4 text-[#E8AA62] shrink-0 group-hover:scale-110 transition-transform" />
                  <span>{cafeAddress}</span>
                </Link>
                <span className="hidden sm:inline text-white/30">•</span>
                <div className="inline-flex items-center gap-2 text-stone-200 text-xs sm:text-sm font-sans font-medium">
                  <Leaf className="w-4 h-4 text-[#E8AA62] shrink-0" />
                  <span>Woodfired Neapolitan Pizza & Roastery</span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.48, duration: 0.5, ease: "easeOut" }}
                className="mt-8 flex flex-wrap items-center gap-4"
              >
                <Link
                  href="/book-table"
                  className="inline-flex items-center gap-2.5 bg-[#C88A48] hover:bg-[#DE9B52] text-[#120D0A] px-8 py-3.5 rounded-xl font-sans text-xs sm:text-sm font-extrabold tracking-[0.2em] uppercase transition-all duration-300 shadow-2xl active:scale-95"
                >
                  <Calendar className="w-4 h-4" />
                  <span>BOOK A TABLE</span>
                </Link>

                <button
                  type="button"
                  aria-expanded={isGetStartedOpen}
                  onClick={() => setIsGetStartedOpen((open) => !open)}
                  className="inline-flex items-center gap-2.5 border border-[#E8AA62]/70 bg-black/40 hover:bg-[#E8AA62] text-white hover:text-[#120D0A] px-6 py-3.5 rounded-xl font-sans text-xs sm:text-sm font-bold tracking-[0.16em] uppercase transition-all duration-300 backdrop-blur-md shadow-xl active:scale-95 cursor-pointer"
                >
                  Explore Menu
                </button>

                {isGetStartedOpen && (
                  <motion.nav
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="basis-full grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 max-w-2xl"
                  >
                    <Link
                      href="/menu"
                      className="group rounded-xl border border-white/20 bg-black/40 hover:border-[#E8AA62] hover:bg-black/55 px-4 py-3 transition-colors"
                    >
                      <Utensils className="w-4 h-4 text-[#E8AA62] mb-3" />
                      <span className="block font-serif text-lg font-bold text-white">Full Menu</span>
                    </Link>
                    <Link
                      href="/location"
                      className="group rounded-xl border border-white/20 bg-black/40 hover:border-[#E8AA62] hover:bg-black/55 px-4 py-3 transition-colors"
                    >
                      <MapPin className="w-4 h-4 text-[#E8AA62] mb-3" />
                      <span className="block font-serif text-lg font-bold text-white">Location</span>
                    </Link>
                    <Link
                      href="/contact"
                      className="group rounded-xl border border-white/20 bg-black/40 hover:border-[#E8AA62] hover:bg-black/55 px-4 py-3 transition-colors"
                    >
                      <Mail className="w-4 h-4 text-[#E8AA62] mb-3" />
                      <span className="block font-serif text-lg font-bold text-white">Contact Us</span>
                    </Link>
                  </motion.nav>
                )}
              </motion.div>
            </div>
          </header>
        </div>
      )}

      {/* Global Restrova Footer */}
      <footer className="border-t border-stone-800/80 bg-[#0E0A08] px-6 py-4 text-center text-xs text-stone-500">
        Restrova Multi-Tenant Restaurant Platform · Powered by Fast Concurrency-Safe Cloud Architecture
      </footer>
    </div>
  );
}
