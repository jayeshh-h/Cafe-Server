"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Smartphone,
  Monitor,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Plus,
  Minus,
  CheckCircle2,
  Bell,
  Clock,
  QrCode,
  DollarSign,
  Utensils,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  isVeg: boolean;
}

interface DemoKot {
  id: string;
  table: string;
  items: { name: string; qty: number }[];
  time: string;
  status: "PREPARING" | "READY" | "SERVED";
}

const DEMO_MENU = [
  {
    id: "m1",
    name: "Margherita D.O.P.",
    price: 450,
    category: "Woodfired Pizza",
    desc: "San Marzano tomatoes, fresh Fior di Latte, sweet basil & extra virgin olive oil.",
    isVeg: true,
  },
  {
    id: "m2",
    name: "Truffle Parmesan Fries",
    price: 320,
    category: "Antipasti",
    desc: "Hand-cut skin-on fries with white truffle oil, sea salt & Parmigiano.",
    isVeg: true,
  },
  {
    id: "m3",
    name: "Mountain Cold Brew",
    price: 240,
    category: "Specialty Coffee",
    desc: "18-hour cold steeped single-origin Arabica with orange zest.",
    isVeg: true,
  },
  {
    id: "m4",
    name: "Classic Venetian Tiramisu",
    price: 340,
    category: "Dolci",
    desc: "Ladyfingers soaked in dark espresso & marsala with mascarpone mousse.",
    isVeg: true,
  },
];

export default function DemoPage() {
  // Mobile Customer State
  const [cart, setCart] = useState<CartItem[]>([
    { id: "m1", name: "Margherita D.O.P.", price: 450, qty: 1, isVeg: true },
    { id: "m3", name: "Mountain Cold Brew", price: 240, qty: 1, isVeg: true },
  ]);
  const [orderSent, setOrderSent] = useState(false);

  // Desktop POS State
  const [selectedTable, setSelectedTable] = useState("T3");
  const [tables, setTables] = useState([
    { number: "T1", capacity: 2, status: "Available", amount: 0 },
    { number: "T2", capacity: 4, status: "Available", amount: 0 },
    { number: "T3", capacity: 4, status: "Occupied", amount: 690 },
    { number: "T4", capacity: 2, status: "Available", amount: 0 },
    { number: "T5", capacity: 6, status: "Reserved", amount: 0 },
    { number: "T6", capacity: 4, status: "Available", amount: 0 },
  ]);

  const [kots, setKots] = useState<DemoKot[]>([
    {
      id: "KOT #101",
      table: "T3",
      items: [
        { name: "Margherita D.O.P.", qty: 1 },
        { name: "Mountain Cold Brew", qty: 1 },
      ],
      time: "Just now",
      status: "PREPARING",
    },
  ]);

  const [posTab, setPosTab] = useState<"floor" | "kitchen" | "bill">("floor");
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  const triggerAlert = (msg: string) => {
    setAlertNotice(msg);
    setTimeout(() => setAlertNotice(null), 3500);
  };

  const addToCart = (item: typeof DEMO_MENU[0]) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, qty: 1, isVeg: item.isVeg }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (existing && existing.qty > 1) {
        return prev.map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i));
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const cartTotal = cart.reduce((acc, curr) => acc + curr.price * curr.qty, 0);

  const handleSendToKitchen = () => {
    if (cart.length === 0) return;
    setOrderSent(true);

    const newKotId = `KOT #${Math.floor(100 + Math.random() * 900)}`;
    const newKot: DemoKot = {
      id: newKotId,
      table: "T3",
      items: cart.map((i) => ({ name: i.name, qty: i.qty })),
      time: "Just now",
      status: "PREPARING",
    };

    setKots((prev) => [newKot, ...prev]);

    // Update table bill amount
    setTables((prev) =>
      prev.map((t) => (t.number === "T3" ? { ...t, status: "Occupied", amount: t.amount + cartTotal } : t))
    );

    triggerAlert(`🔔 New Order from Table 3! ${newKotId} added to Kitchen Rail.`);

    setTimeout(() => {
      setOrderSent(false);
      setCart([]);
    }, 2000);
  };

  const resetDemo = () => {
    setCart([
      { id: "m1", name: "Margherita D.O.P.", price: 450, qty: 1, isVeg: true },
      { id: "m3", name: "Mountain Cold Brew", price: 240, qty: 1, isVeg: true },
    ]);
    setKots([
      {
        id: "KOT #101",
        table: "T3",
        items: [
          { name: "Margherita D.O.P.", qty: 1 },
          { name: "Mountain Cold Brew", qty: 1 },
        ],
        time: "Just now",
        status: "PREPARING",
      },
    ]);
    setTables([
      { number: "T1", capacity: 2, status: "Available", amount: 0 },
      { number: "T2", capacity: 4, status: "Available", amount: 0 },
      { number: "T3", capacity: 4, status: "Occupied", amount: 690 },
      { number: "T4", capacity: 2, status: "Available", amount: 0 },
      { number: "T5", capacity: 6, status: "Reserved", amount: 0 },
      { number: "T6", capacity: 4, status: "Available", amount: 0 },
    ]);
    triggerAlert("Demo state reset to Table 3 active session.");
  };

  return (
    <div className="min-h-screen bg-[#0E0A08] text-stone-100 font-sans flex flex-col justify-between selection:bg-[#C86D51]/30">
      {/* Top Banner & Header */}
      <header className="border-b border-stone-800 bg-[#120D0A]/90 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#C86D51] to-[#E8AA62] flex items-center justify-center font-serif font-black text-stone-950 text-base shadow-md group-hover:scale-105 transition-transform">
              R
            </div>
            <div>
              <span className="font-serif font-bold text-lg text-white">RESTROVA</span>
              <span className="text-[9px] uppercase tracking-wider text-[#E8AA62] block font-semibold -mt-1">
                Interactive Sandbox
              </span>
            </div>
          </Link>
        </div>

        {/* Live Notification Pill */}
        <AnimatePresence>
          {alertNotice && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="hidden md:flex items-center gap-2 bg-[#E8AA62] text-stone-950 px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg shadow-[#E8AA62]/20"
            >
              <Bell className="w-3.5 h-3.5 animate-bounce" />
              <span>{alertNotice}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          <button
            onClick={resetDemo}
            className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Sandbox</span>
          </button>
          <Link
            href="/onboard"
            className="px-4 py-1.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 font-semibold text-xs rounded-lg hover:brightness-110 flex items-center gap-1.5 shadow-md transition-all"
          >
            <span>Launch My Café</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* Guide Banner */}
      <div className="bg-stone-900/70 border-b border-stone-800/80 px-4 py-2.5 text-center text-xs text-stone-400">
        <span className="text-[#E8AA62] font-semibold">Live Interactive Experience:</span> Tap dishes on the
        left Mobile QR screen to add items and send to kitchen. Watch the right POS Terminal update live in real-time!
      </div>

      {/* Split Dual-Screen Sandbox */}
      <main className="flex-1 p-3 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">
        {/* LEFT PANE: GUEST MOBILE QR INTERFACE */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">
            <Smartphone className="w-4 h-4 text-[#E8AA62]" />
            <span>Guest View · Scanned Table 3 QR</span>
          </div>

          {/* Smartphone Frame Mockup */}
          <div className="w-full max-w-sm rounded-[40px] border-4 border-stone-700 bg-stone-950 shadow-2xl p-3 relative overflow-hidden flex flex-col min-h-[660px]">
            {/* Speaker & camera notch */}
            <div className="w-28 h-4 bg-stone-800 rounded-full mx-auto mb-2 flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-stone-950 rounded-full" />
            </div>

            {/* Mobile Content */}
            <div className="flex-1 flex flex-col justify-between bg-[#15100D] rounded-[28px] p-4 border border-stone-800 text-stone-200 overflow-y-auto no-scrollbar">
              {/* Café Header */}
              <div className="border-b border-stone-800/80 pb-3 mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-serif font-bold text-base text-white">Bella Napoli</h3>
                  <span className="text-[10px] text-stone-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Table 3 · Session Active
                  </span>
                </div>
                <div className="p-1.5 bg-stone-800/80 rounded-lg text-[10px] font-mono text-[#E8AA62]">
                  0% Direct UPI
                </div>
              </div>

              {/* Menu Items */}
              <div className="space-y-3 flex-1 mb-4">
                <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block">
                  Artisanal Menu
                </span>

                {DEMO_MENU.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-stone-900/60 border border-stone-800/80 rounded-xl hover:border-stone-700 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${item.isVeg ? "bg-emerald-400" : "bg-rose-400"}`} />
                        <h4 className="font-serif font-medium text-xs text-white truncate">{item.name}</h4>
                      </div>
                      <p className="text-[10px] text-stone-400 line-clamp-1 mt-0.5">{item.desc}</p>
                      <span className="text-xs font-bold text-[#E8AA62] mt-1 block">₹{item.price}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => addToCart(item)}
                      className="px-2.5 py-1.5 bg-[#E8AA62]/10 hover:bg-[#E8AA62]/20 border border-[#E8AA62]/40 rounded-lg text-[#E8AA62] text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                ))}
              </div>

              {/* Bottom Cart Drawer inside Phone */}
              <div className="border-t border-stone-800 pt-3 bg-[#15100D]/95">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-stone-400 font-medium">Cart ({cart.reduce((a, b) => a + b.qty, 0)} items)</span>
                  <span className="font-bold text-white text-sm">₹{cartTotal}</span>
                </div>

                {cart.length > 0 && (
                  <div className="max-h-20 overflow-y-auto space-y-1 mb-2 pr-1 no-scrollbar text-xs">
                    {cart.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-[11px] text-stone-300">
                        <span className="truncate pr-2">
                          {c.qty}x {c.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span>₹{c.price * c.qty}</span>
                          <button
                            type="button"
                            onClick={() => removeFromCart(c.id)}
                            className="text-stone-500 hover:text-rose-400"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  disabled={cart.length === 0 || orderSent}
                  onClick={handleSendToKitchen}
                  className="w-full py-2.5 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-40 transition-all shadow-lg"
                >
                  {orderSent ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-950" /> Sent to Kitchen!
                    </span>
                  ) : (
                    <span>Send Order to Kitchen (₹{cartTotal})</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: DESKTOP POS & KITCHEN TERMINAL */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <Monitor className="w-4 h-4 text-[#E8AA62]" />
              <span>Manager & Staff Terminal (Live Cloud POS)</span>
            </div>

            <div className="flex items-center gap-1 bg-stone-900 border border-stone-800 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setPosTab("floor")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  posTab === "floor" ? "bg-[#E8AA62] text-stone-950 font-bold" : "text-stone-400 hover:text-white"
                }`}
              >
                Table Floor
              </button>
              <button
                type="button"
                onClick={() => setPosTab("kitchen")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  posTab === "kitchen" ? "bg-[#E8AA62] text-stone-950 font-bold" : "text-stone-400 hover:text-white"
                }`}
              >
                Kitchen KOTs ({kots.length})
              </button>
              <button
                type="button"
                onClick={() => setPosTab("bill")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  posTab === "bill" ? "bg-[#E8AA62] text-stone-950 font-bold" : "text-stone-400 hover:text-white"
                }`}
              >
                Bill & Settle
              </button>
            </div>
          </div>

          {/* POS Terminal Screen */}
          <div className="bg-[#120D0A] border border-stone-800 rounded-2xl p-5 shadow-2xl min-h-[660px] flex flex-col justify-between">
            {/* VIEW 1: TABLE FLOOR */}
            {posTab === "floor" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <div>
                    <h2 className="font-serif font-bold text-lg text-white">Main Dining Floor</h2>
                    <p className="text-xs text-stone-400">Click any table to view live session & guest tabs</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-stone-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available
                    </span>
                    <span className="flex items-center gap-1.5 text-stone-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Occupied
                    </span>
                    <span className="flex items-center gap-1.5 text-stone-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Reserved
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                  {tables.map((t) => {
                    const isSelected = selectedTable === t.number;
                    const isOccupied = t.status === "Occupied";
                    return (
                      <div
                        key={t.number}
                        onClick={() => setSelectedTable(t.number)}
                        className={`cursor-pointer p-4 rounded-xl border transition-all ${
                          isSelected
                            ? "border-[#E8AA62] bg-stone-900 shadow-xl ring-1 ring-[#E8AA62]"
                            : "border-stone-800 bg-stone-900/40 hover:border-stone-700"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-serif font-bold text-lg text-white">{t.number}</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              t.status === "Available"
                                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                                : t.status === "Occupied"
                                ? "bg-amber-950/60 text-amber-400 border border-amber-800"
                                : "bg-purple-950/60 text-purple-400 border border-purple-800"
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <div className="text-xs text-stone-400 mb-2">Capacity: {t.capacity} Guests</div>
                        <div className="flex items-center justify-between text-xs pt-2 border-t border-stone-800/80">
                          <span className="text-stone-500 font-medium">Running Total:</span>
                          <span className="font-bold text-white">₹{t.amount}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Table Detail Card */}
                <div className="p-4 bg-stone-900/60 border border-stone-800 rounded-xl mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm text-[#E8AA62]">{selectedTable} Session Breakdown</span>
                    <button
                      type="button"
                      onClick={() => setPosTab("bill")}
                      className="text-xs text-stone-300 hover:text-white underline"
                    >
                      View Detailed Bill &rarr;
                    </button>
                  </div>
                  <p className="text-xs text-stone-400">
                    Live digital ordering token is attached. Orders placed by guest from smartphone auto-sync with KDS rail without waiter intervention.
                  </p>
                </div>
              </div>
            )}

            {/* VIEW 2: KITCHEN DISPLAY KOTS */}
            {posTab === "kitchen" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <div>
                    <h2 className="font-serif font-bold text-lg text-white">Kitchen Display System (KDS)</h2>
                    <p className="text-xs text-stone-400">Real-time order rail for kitchen chefs and barista line</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-emerald-950/70 border border-emerald-800 text-emerald-400 rounded-lg flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> WebSocket Live
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {kots.map((k) => (
                    <div key={k.id} className="p-4 bg-stone-900 border border-stone-800 rounded-xl shadow-lg space-y-3">
                      <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                        <div>
                          <span className="font-mono text-xs font-bold text-[#E8AA62] block">{k.id}</span>
                          <span className="font-serif font-bold text-white text-base">Table: {k.table}</span>
                        </div>
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-semibold">
                          {k.status}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {k.items.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs text-stone-200">
                            <span className="font-medium">
                              {item.qty}x {item.name}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-stone-800 text-[11px] text-stone-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {k.time}
                        </span>
                        <button
                          type="button"
                          onClick={() => triggerAlert(`${k.id} marked READY! Waiter notified for table ${k.table}.`)}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-600/50 text-emerald-300 rounded text-xs font-semibold transition-colors"
                        >
                          Mark Ready
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* VIEW 3: BILL & DIRECT UPI SETTLEMENT */}
            {posTab === "bill" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <div>
                    <h2 className="font-serif font-bold text-lg text-white">Table 3 Final Bill</h2>
                    <p className="text-xs text-stone-400">Direct 0% commission UPI QR settlement</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-stone-800 text-stone-300 rounded font-mono">
                    GST 5.0% Included
                  </span>
                </div>

                <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-5 space-y-4">
                  <div className="space-y-2 border-b border-stone-800 pb-3 text-xs">
                    <div className="flex justify-between text-stone-300">
                      <span>1x Margherita D.O.P.</span>
                      <span>₹450.00</span>
                    </div>
                    <div className="flex justify-between text-stone-300">
                      <span>1x Mountain Cold Brew</span>
                      <span>₹240.00</span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-stone-400">
                      <span>Subtotal</span>
                      <span>₹657.14</span>
                    </div>
                    <div className="flex justify-between text-stone-400">
                      <span>CGST (2.5%)</span>
                      <span>₹16.43</span>
                    </div>
                    <div className="flex justify-between text-stone-400">
                      <span>SGST (2.5%)</span>
                      <span>₹16.43</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-white pt-2 border-t border-stone-800">
                      <span>Grand Total</span>
                      <span className="text-[#E8AA62]">₹690.00</span>
                    </div>
                  </div>

                  {/* Direct UPI Payment Showcase */}
                  <div className="p-4 bg-stone-950 rounded-xl border border-stone-800 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-stone-900 rounded-lg text-[#E8AA62]">
                        <QrCode className="w-8 h-8" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-white">Dynamic UPI VPA QR</h4>
                        <span className="text-[11px] text-stone-400 font-mono block">bellanapoli@icici</span>
                        <span className="text-[10px] text-emerald-400 font-medium">Funds settle directly into owner's bank account</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => triggerAlert("Payment received! Table 3 bill settled and session closed.")}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-bold text-xs rounded-lg transition-colors shadow-lg"
                    >
                      Settle Cash / Card
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Terminal Status Bar */}
            <div className="border-t border-stone-800 pt-3 flex items-center justify-between text-[11px] text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Restrova Multi-Tenant Cloud Terminal 1
              </span>
              <span>Logged in as Admin (Owner)</span>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom CTA Banner */}
      <footer className="border-t border-stone-800/80 bg-[#120D0A] px-6 py-6 text-center">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <h3 className="font-serif font-bold text-lg text-white">Ready to modernize your restaurant?</h3>
            <p className="text-xs text-stone-400">Launch in 5 minutes with 14 days free trial. Zero setup fees.</p>
          </div>
          <Link
            href="/onboard"
            className="px-6 py-3 bg-gradient-to-r from-[#C86D51] to-[#E8AA62] text-stone-950 font-bold text-sm rounded-xl hover:brightness-110 flex items-center gap-2 shadow-xl transition-all shrink-0"
          >
            Launch Your Café Now <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
