"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import BrandTitle from "@/components/BrandTitle";
import { motion, AnimatePresence } from "framer-motion";
import {
  UtensilsCrossed,
  Receipt,
  Plus,
  Minus,
  ShoppingBag,
  CheckCircle2,
  X,
  Info,
  ChevronRight,
  Coffee,
  Pizza,
  Wine,
  Utensils,
  Calendar,
  AlertTriangle,
  Users,
  Clock,
  Sparkles,
  CakeSlice,
  Zap,
  ShieldCheck,
  HeartHandshake,
} from "lucide-react";
import { ITEM_MEDIA_MAP, menuData, MENU_ITEM_ID_MAP, fetchLiveMenu as loadLiveMenu } from "@/data/menu";
import { toast } from "@/components/ui/toast";
import { getFloorName } from "@/data/floors";
import { ALL_COUNTRY_CODES } from "@/lib/countryCodes";

const categoryIcons: Record<string, React.ReactNode> = {
  starters: <Utensils className="w-4 h-4 text-[#9E3E26]" />,
  primo: <Utensils className="w-4 h-4 text-[#9E3E26]" />,
  pizza: <Pizza className="w-4 h-4 text-[#9E3E26]" />,
  cakes: <CakeSlice className="w-4 h-4 text-[#9E3E26]" />,
  beverages: <Wine className="w-4 h-4 text-[#9E3E26]" />,
  "hot-drinks": <Coffee className="w-4 h-4 text-[#9E3E26]" />,
};

interface MenuItem {
  id: string | number;
  category_id?: number | string;
  name: string;
  description: string;
  price: number;
  is_available?: boolean;
  is_sold_out?: boolean;
  category_name: string;
  badge?: string;
  image_url: string;
  tags?: string[];
}

interface BillItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
}

interface BillData {
  session_id: number;
  table_number: string;
  status: string;
  items: BillItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  allergy_info?: string | null;
}

// Guests go straight to the menu while this is in the future (end of 17 Oct 2026, India time)
const CHECKIN_POPUP_PAUSED_UNTIL = new Date("2026-10-17T23:59:59+05:30").getTime();

export default function TableQRPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const rawToken = resolvedParams.token || "";

  const [tableNumber, setTableNumber] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [validatedQrToken, setValidatedQrToken] = useState<string>(rawToken);
  const [isValidating, setIsValidating] = useState(true);
  const [isValidQr, setIsValidQr] = useState<boolean | null>(null);
  const [qrErrorMessage, setQrErrorMessage] = useState<string | null>(null);
  const [showReservationIdPrompt, setShowReservationIdPrompt] = useState(false);
  const [reservationIdInput, setReservationIdInput] = useState("");
  // ponytail: minimal 2-option state: reservation ID or walk-in
  const [guestMode, setGuestMode] = useState<"reservation" | "walkin">("reservation");
  const [walkInName, setWalkInName] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [walkInCountryCode, setWalkInCountryCode] = useState<string>("+91");
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [hasTableAccess, setHasTableAccess] = useState(false);
  const [reservationNotice, setReservationNotice] = useState<{
    is_reserved: boolean;
    reservation_id: number;
    customer_name: string;
    guest_count: number;
    time_slot: string;
    reservation_date: string;
    status: string;
    floor_number?: number;
    table_name?: string;
    minutes_until_reservation?: number;
    can_quick_dine?: boolean;
    quick_dine_minutes?: number;
    allow_self_checkin?: boolean;
  } | null>(null);

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [checkInSuccess, setCheckInSuccess] = useState(false);
  const [isQuickDineActive, setIsQuickDineActive] = useState(false);
  const [quickDineMinutesLeft, setQuickDineMinutesLeft] = useState<number | null>(null);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [liveMenuData, setLiveMenuData] = useState(menuData);
  const [cart, setCart] = useState<{ [key: string | number]: { item: MenuItem; qty: number } }>({});
  const [allergyInfo, setAllergyInfo] = useState("");
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [billData, setBillData] = useState<BillData | null>(null);
  const [dispatchedItems, setDispatchedItems] = useState<Array<{ name: string; quantity: number; price: number; total: number }>>([]);
  const [loadingBill, setLoadingBill] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [lastOrderNum, setLastOrderNum] = useState("");

  const getApiBase = () => {
    return "";
  };

  // The menu as set up in admin (new dishes included), with live prices and stock
  const fetchLiveMenu = React.useCallback(async () => {
    const live = await loadLiveMenu(getApiBase());
    if (live) setLiveMenuData(live);
  }, []);

  // Live WebSocket listener for instant hand-to-hand menu status updates
  useEffect(() => {
    fetchLiveMenu();

    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const getWsBase = () => {
      if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
      if (typeof window !== "undefined") {
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        if (isLocal) {
          return "ws://127.0.0.1:8000";
        }
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}`;
      }
      return "";
    };

    const connectWS = () => {
      try {
        const wsBase = getWsBase();
        if (!wsBase) return;
        ws = new WebSocket(`${wsBase}/ws/menu`);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "MENU_UPDATED") {
              fetchLiveMenu();
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connectWS, 5000);
        };
      } catch {
        reconnectTimeout = setTimeout(connectWS, 6000);
      }
    };

    connectWS();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchLiveMenu();
    }, 30000);

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(interval);
    };
  }, [fetchLiveMenu]);

  // Validate QR Token on mount
  useEffect(() => {
    async function validateQR() {
      setIsValidating(true);
      const apiBase = getApiBase();
      try {
        const res = await fetch(`${apiBase}/api/v1/tables/qr/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr_token: rawToken }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.is_generalized) {
            setTableNumber("Table allotted by server");
          } else {
            const cleanNum = data.table_number.replace(/[^0-9]/g, "").padStart(2, "0") || data.table_number;
            setTableNumber(`TABLE ${cleanNum}`);
          }
          setSessionId(data.session_id);
          setSessionToken(data.session_token);
          setValidatedQrToken(rawToken);
          setIsValidQr(true);
          // Welcome pop-up (Reservation ID / Walk-in) is paused until the date below, then returns by itself
          if (Date.now() > CHECKIN_POPUP_PAUSED_UNTIL) setShowReservationIdPrompt(true);
          if (data.is_reserved && data.reservation) {
            setReservationNotice(data.reservation);
            if (data.reservation.quick_dine_minutes) {
              setQuickDineMinutesLeft(data.reservation.quick_dine_minutes);
            }
          } else {
            setReservationNotice(null);
          }
        } else {
          setIsValidQr(false);
          const errData = await res.json().catch(() => null);
          const detail = typeof errData?.detail === "string" ? errData.detail : "";
          if (detail.toLowerCase().includes("deactivated") || detail.toLowerCase().includes("inactive")) {
            setQrErrorMessage("This QR code is currently inactive or deactivated. Please ask our staff for an active QR code.");
          } else {
            setQrErrorMessage(detail || "This table QR code is invalid, expired, or has rotated. Direct URL manipulation is prohibited for dining privacy.");
          }
          setSessionId(null);
          setSessionToken(null);
        }
      } catch {
        setIsValidQr(false);
        setQrErrorMessage("Unable to verify table QR code. Please check your network connection.");
        setSessionId(null);
        setSessionToken(null);
      } finally {
        setIsValidating(false);
      }
    }
    validateQR();
  }, [rawToken]);

  // 5. Multi-Device Shared Table Cart & Bill: Real-time background sync every 6s
  useEffect(() => {
    if (!sessionId || !sessionToken || !hasTableAccess) return;

    let isMounted = true;
    const syncTableBill = async () => {
      const apiBase = getApiBase();
      try {
        const res = await fetch(`${apiBase}/api/v1/tables/sessions/${sessionId}/bill`, {
          headers: { "X-Session-Token": sessionToken },
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          setBillData(data);
          if (data.items && data.items.length > 0) {
            setDispatchedItems(data.items);
          }
        }
      } catch {
        // silent sync fallback
      }
    };

    syncTableBill();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") syncTableBill();
    }, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId, sessionToken, hasTableAccess]);

  // Quick Dine Countdown Timer
  useEffect(() => {
    if (!isQuickDineActive || quickDineMinutesLeft === null) return;
    const interval = setInterval(() => {
      setQuickDineMinutesLeft((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [isQuickDineActive, quickDineMinutesLeft]);

  // 3. 1-Tap Self Check-In via QR Scan
  const handleSelfCheckIn = async () => {
    if (!reservationNotice) return;
    setIsCheckingIn(true);
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/v1/reservations/${reservationNotice.reservation_id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: sessionToken }),
      });
      if (res.ok) {
        setCheckInSuccess(true);
        setReservationNotice((prev) =>
          prev ? { ...prev, status: "SEATED", allow_self_checkin: false } : null
        );
        toast.success("Check-in successful! Welcome to Jaadoo Pizza Project.");
      } else {
        toast.error("Check-in could not be completed. Please inform your server or floor manager.");
      }
    } catch {
      toast.error("Network error during check-in. Please try again.");
    } finally {
      setIsCheckingIn(false);
    }
  };

  // ponytail: seamless match by numeric ID or 4-letter + 4-phone booking code
  const continueFromReservationPrompt = async () => {
    const entered = reservationIdInput.trim();
    if (!entered) {
      setPromptError("Please enter your reservation ID to continue.");
      return;
    }

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/v1/tables/qr/claim-reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_token: validatedQrToken || rawToken,
          session_token: sessionToken || "",
          reservation_code: entered,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.table_number) {
          setTableNumber(data.table_number);
        }
        setPromptError(null);
        setHasTableAccess(true);
        setShowReservationIdPrompt(false);
        return;
      }

      // If backend claim returned an error, verify against local notice as fallback
      if (reservationNotice) {
        const numericPart = entered.replace(/\D/g, "");
        const enteredNum = numericPart ? Number(numericPart) : NaN;
        const cleanEntered = entered.toUpperCase().replace(/\s+/g, "");
        const expectedLetters = (reservationNotice.customer_name || "").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4);

        const isIdMatch = !isNaN(enteredNum) && enteredNum === reservationNotice.reservation_id;
        const isCodeMatch = cleanEntered.startsWith(expectedLetters) && cleanEntered.length >= 4;

        if (isIdMatch || isCodeMatch) {
          setPromptError(null);
          setHasTableAccess(true);
          setShowReservationIdPrompt(false);
          return;
        }
      }

      const errData = await res.json().catch(() => null);
      setPromptError(errData?.detail || "That reservation ID was not found or is already seated.");
    } catch {
      // Offline / fallback verification
      if (reservationNotice) {
        const numericPart = entered.replace(/\D/g, "");
        const enteredNum = numericPart ? Number(numericPart) : NaN;
        const cleanEntered = entered.toUpperCase().replace(/\s+/g, "");
        const expectedLetters = (reservationNotice.customer_name || "").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4);
        const isIdMatch = !isNaN(enteredNum) && enteredNum === reservationNotice.reservation_id;
        const isCodeMatch = cleanEntered.startsWith(expectedLetters) && cleanEntered.length >= 4;
        if (isIdMatch || isCodeMatch) {
          setPromptError(null);
          setHasTableAccess(true);
          setShowReservationIdPrompt(false);
          return;
        }
      }
      setPromptError("Network error. Please try again.");
    }
  };

  // ponytail: simple walk-in registration auto-creates reservation on backend with domestic & intl country codes
  const handleWalkInSubmit = async () => {
    const trimmedName = walkInName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setPromptError("Please enter your name (at least 2 letters).");
      return;
    }
    const cleanDigits = walkInPhone.replace(/\D/g, "");
    let cleanPhone = cleanDigits;
    if (walkInCountryCode === "+91") {
      if (cleanPhone.length > 10 && cleanPhone.startsWith("91")) cleanPhone = cleanPhone.slice(2);
      else if (cleanPhone.length > 10 && cleanPhone.startsWith("0")) cleanPhone = cleanPhone.slice(1);
      if (cleanPhone.length !== 10 || !/^[6-9]\d{9}$/.test(cleanPhone)) {
        setPromptError("Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.");
        return;
      }
    } else {
      if (cleanDigits.length < 7 || cleanDigits.length > 15 || /^(\d)\1+$/.test(cleanDigits)) {
        setPromptError("Please enter a valid phone number (7 to 15 digits).");
        return;
      }
      cleanPhone = `${walkInCountryCode}${cleanDigits}`;
    }


    setIsSubmittingWalkIn(true);
    setPromptError(null);
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/v1/tables/qr/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_token: validatedQrToken || rawToken,
          customer_name: walkInName.trim(),
          phone_number: cleanPhone,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setPromptError(errData.detail || "Unable to register walk-in. Please notify staff.");
        return;
      }

      const data = await res.json();
      setReservationNotice({
        is_reserved: true,
        reservation_id: data.reservation_id,
        customer_name: data.customer_name || walkInName.trim(),
        guest_count: 2,
        time_slot: "Walk-in",
        reservation_date: new Date().toISOString().split("T")[0],
        status: "SEATED",
        table_name: data.table_number || tableNumber,
      });
      setCheckInSuccess(true);
      setHasTableAccess(true);
      setShowReservationIdPrompt(false);
    } catch {
      setPromptError("Network error. Please try again.");
    } finally {
      setIsSubmittingWalkIn(false);
    }
  };

  // 4. Quick Dine Acceptance Handler
  const handleAcceptQuickDine = () => {
    setIsQuickDineActive(true);
    if (reservationNotice?.quick_dine_minutes) {
      setQuickDineMinutesLeft(reservationNotice.quick_dine_minutes);
    }
  };

  const updateCart = (item: any, delta: number) => {
    setCart((prev) => {
      const current = prev[item.id]?.qty || 0;
      const next = Math.min(current + delta, 50); // matches the server cap per dish
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      }
      return {
        ...prev,
        [item.id]: { item, qty: next },
      };
    });
  };

  const totalCartCount = Object.values(cart).reduce((sum, c) => sum + c.qty, 0);
  const totalCartPrice = Object.values(cart).reduce((sum, c) => sum + c.item.price * c.qty, 0);
  const cartTax = Math.round(totalCartPrice * 0.05 * 100) / 100;
  const cartGrandTotal = totalCartPrice + cartTax;

  const fetchBill = async () => {
    if (!sessionId || !sessionToken) return;
    setShowBillModal(true);
    setLoadingBill(true);
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/v1/tables/sessions/${sessionId}/bill`, {
        headers: {
          "X-Session-Token": sessionToken,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setBillData(data);
      } else {
        const sub = dispatchedItems.reduce((acc, it) => acc + it.total, 0);
        const tax = sub * 0.05;
        setBillData({
          session_id: sessionId,
          table_number: tableNumber,
          status: "ACTIVE",
          items: dispatchedItems,
          subtotal: sub,
          tax_rate: 0.05,
          tax_amount: tax,
          grand_total: sub + tax,
        });
      }
    } catch {
      const sub = dispatchedItems.reduce((acc, it) => acc + it.total, 0);
      const tax = sub * 0.05;
      setBillData({
        session_id: sessionId,
        table_number: tableNumber,
        status: "ACTIVE",
        items: dispatchedItems,
        subtotal: sub,
        tax_rate: 0.05,
        tax_amount: tax,
        grand_total: sub + tax,
      });
    } finally {
      setLoadingBill(false);
    }
  };

  const handleSendOrderToKitchen = async () => {
    if (totalCartCount === 0 || !sessionToken) return;
    const apiBase = getApiBase();

    const orderPayload = {
      qr_token: validatedQrToken,
      session_token: sessionToken,
      allergy_info: allergyInfo.trim() || undefined,
      items: Object.values(cart).map((c) => {
        const idStr = String(c.item.id);
        const mappedId = MENU_ITEM_ID_MAP[idStr] || (typeof c.item.id === "number" ? c.item.id : parseInt(idStr, 10));
        return {
          menu_item_id: mappedId && !isNaN(mappedId) && mappedId > 0 ? mappedId : undefined,
          name: c.item.name,
          quantity: c.qty,
        };
      }),
    };

    try {
      const res = await fetch(`${apiBase}/api/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": sessionToken,
        },
        body: JSON.stringify(orderPayload),
      });

      if (res.ok) {
        const data = await res.json();
        setLastOrderNum(data.order_number || `ORD-${Date.now().toString().slice(-6)}`);
        if (data.dining_session_id) {
          setSessionId(data.dining_session_id);
        }
        const newlyDispatched = Object.values(cart).map((c) => ({
          name: c.item.name,
          quantity: c.qty,
          price: c.item.price,
          total: c.item.price * c.qty,
        }));
        setDispatchedItems((prev) => [...prev, ...newlyDispatched]);
        setOrderPlaced(true);
        setCart({});
        setAllergyInfo("");
        setShowCartDrawer(false);
        toast.success("Order dispatched to kitchen! Tracking on table.");
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Order could not be placed: ${typeof errData.detail === "string" ? errData.detail : "Please check the quantities and try again."}`);
      }
    } catch {
      toast.error("Network error. Please make sure the café server is reachable.");
    }
  };

  // 1. Loading State
  if (isValidating) {
    return (
      <div className="min-h-screen bg-[#F8F5F0] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-3 border-[#261C18] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-condensed text-xl font-bold uppercase tracking-wider text-[#261C18]">
          Verifying Table QR Session...
        </p>
      </div>
    );
  }

  // 2. Invalid or Expired QR Error State (e.g. /table/1 without valid QR token)
  if (isValidQr === false) {
    return (
      <div className="min-h-screen bg-[#F8F5F0] text-[#261C18] font-sans flex flex-col justify-between p-6">
        <div className="max-w-md mx-auto my-auto w-full bg-white rounded-3xl p-8 border border-[#E4DCD0] shadow-xl text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto text-amber-700">
            <UtensilsCrossed className="w-8 h-8" />
          </div>
          <h2 className="font-condensed text-3xl font-extrabold uppercase tracking-wide text-[#261C18]">
            {qrErrorMessage?.toLowerCase().includes("deactivated") || qrErrorMessage?.toLowerCase().includes("inactive")
              ? "QR Code Deactivated"
              : "Invalid Table QR"}
          </h2>
          <p className="text-sm text-gray-600 font-sans leading-relaxed">
            {qrErrorMessage || "This QR code is invalid, expired, or has rotated. Please scan the official QR code placed on your dining table."}
          </p>
          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200/80 text-xs text-amber-900 font-sans flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
            <span>For guest security and bill isolation, direct table number URLs (such as /table/1) are not allowed.</span>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <a
              href="/"
              className="w-full bg-[#261C18] text-white py-3.5 rounded-full font-condensed font-bold uppercase tracking-wider hover:bg-[#B85B43] transition-colors text-sm"
            >
              Explore Public Menu & Home
            </a>
            <a
              href="/book-table"
              className="w-full bg-white border border-[#261C18] text-[#261C18] py-3.5 rounded-full font-condensed font-bold uppercase tracking-wider hover:bg-gray-50 transition-colors text-sm"
            >
              Reserve a Table
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7EBD5] text-[#17251A] font-sans selection:bg-[#9E3E26] selection:text-white">
      {/* Direct Focused Header: Table Number & View Bill */}
      <header className="sticky top-0 z-40 border-b border-[#D7C4A3] bg-[#FFF9EE]/95 backdrop-blur-md">
        {/* Mobile View (< sm): Clean 2-Tier Layout to completely prevent overlapping */}
        <div className="sm:hidden px-3 py-2 flex flex-col gap-1.5">
          {/* Tier 1: Brand Logo & Jaadoo Pizza Project centered */}
          <div className="flex items-center justify-center">
            <Link href="/" className="flex items-center gap-2 group shrink-0">
              <div className="w-10 h-7 rounded-lg overflow-hidden bg-white border border-[#9E3E26]/40 shadow-xs shrink-0">
                <img
                  src="/jaadoo_logo.jpg"
                  alt="Jaadoo Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-sm leading-tight" />
            </Link>
          </div>

          {/* Tier 2: Table Badge on Left, View Bill on Right */}
          <div className="flex items-center justify-between pt-1 border-t border-[#D7C4A3]/40">
            <span className="text-[10px] font-mono font-bold text-[#1B3618] bg-[#1B3618]/10 border border-[#1B3618]/20 px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {tableNumber}
            </span>

            <button
              onClick={fetchBill}
              className="flex items-center gap-1 px-3 py-1 rounded-full bg-[#261C18] active:bg-[#B85B43] text-[#FBF9F5] text-[10px] font-bold uppercase tracking-wider transition-all shadow-xs shrink-0 cursor-pointer"
            >
              <Receipt className="w-3 h-3 text-[#B85B43]" />
              <span>
                VIEW BILL
                {billData && billData.grand_total > 0 ? ` (₹${Math.round(billData.grand_total)})` : ""}
              </span>
            </button>
          </div>
        </div>

        {/* Desktop / Tablet View (>= sm): 3-Column Centered Layout */}
        <div className="hidden sm:grid mx-auto max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 sm:px-6">
          {/* Left: Table Indicator */}
          <div className="flex items-center justify-start min-w-0">
            <span className="text-xs font-mono font-bold text-[#1B3618] bg-[#1B3618]/10 border border-[#1B3618]/20 px-2.5 py-1 rounded-md flex items-center gap-1.5 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {tableNumber}
            </span>
          </div>

          {/* Center: Editorial Brand Logo & Jaadoo Pizza Project */}
          <div className="flex items-center justify-center min-w-0">
            <Link href="/" className="flex items-center gap-2.5 sm:gap-3 group shrink-0">
              <div className="w-14 h-9 sm:w-18 sm:h-11 rounded-xl overflow-hidden bg-white border-2 border-[#9E3E26]/40 shadow-xs shrink-0 group-hover:border-[#9E3E26] transition-all">
                <img
                  src="/jaadoo_logo.jpg"
                  alt="Jaadoo Logo"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="flex flex-col justify-center min-w-0 text-center sm:text-left">
                <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-sm sm:text-base leading-tight truncate" />
                <span className="text-[9px] font-sans tracking-wide text-[#B6623B] font-bold leading-none mt-0.5 hidden sm:inline">
                  Con o senza avanti!
                </span>
              </div>
            </Link>
          </div>

          {/* Right: Bill Action */}
          <div className="flex items-center justify-end">
            <button
              onClick={fetchBill}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#261C18] hover:bg-[#B85B43] text-[#FBF9F5] text-xs font-semibold uppercase tracking-wider transition-all shadow-xs shrink-0 cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5 text-[#B85B43]" />
              <span>
                VIEW BILL
                {billData && billData.grand_total > 0 ? ` (₹${Math.round(billData.grand_total)})` : ""}
              </span>
            </button>
          </div>
        </div>
      </header>

      <section className="grid min-h-[310px] bg-[#1B120E] text-[#FFF8EA] lg:grid-cols-[42%_58%]">
        <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-[max(3rem,calc((100vw-1200px)/2))] lg:pr-10">
          <div className="flex items-center gap-3 text-[#D59A5C]"><span className="h-px w-10 bg-current" /><span className="text-xs font-semibold tracking-[0.22em]">ORDER FROM {tableNumber}</span></div>
          <h1 className="mt-5 font-serif text-5xl font-bold leading-none sm:text-6xl">Our Menu</h1>
          <p className="mt-3 font-serif text-2xl italic text-[#D59A5C]">Italian kitchen magic.</p>
          <p className="mt-5 max-w-md text-sm leading-7 text-[#E7D9C7]">Choose your dishes, review the order, and send it directly to our kitchen.</p>
        </div>
        <div className="relative min-h-[250px] overflow-hidden lg:min-h-full">
          <img src="/pizza-sophia-loren.webp" alt="Sophia Loren wood-fired pizza" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1B120E]/45 to-transparent lg:from-[#1B120E]/70" />
        </div>
      </section>

      {/* Main Container: Pure Menu & Bill Flow */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-32 sm:px-6 sm:py-10">
        <AnimatePresence>
          {showReservationIdPrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm rounded-2xl bg-[#FFF9EE] p-6 shadow-2xl">
                <h2 className="font-serif text-2xl font-bold text-[#261C18]">Welcome to your table</h2>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-[#5A4A3D]">Select an option to unlock your table menu.</p>

                {/* ponytail: 2 options tabs - Reservation ID or Walk-in */}
                <div className="mt-4 grid grid-cols-2 p-1 rounded-xl bg-[#EFE6D6] gap-1">
                  <button
                    type="button"
                    onClick={() => { setGuestMode("reservation"); setPromptError(null); }}
                    className={`py-2 text-xs font-bold rounded-lg transition-all ${guestMode === "reservation" ? "bg-[#261C18] text-white shadow-xs" : "text-[#705844] hover:text-[#261C18]"}`}
                  >
                    Reservation ID
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGuestMode("walkin"); setPromptError(null); }}
                    className={`py-2 text-xs font-bold rounded-lg transition-all ${guestMode === "walkin" ? "bg-[#261C18] text-white shadow-xs" : "text-[#705844] hover:text-[#261C18]"}`}
                  >
                    Walk-in
                  </button>
                </div>

                {/* Option 1: Reservation ID Flow */}
                {guestMode === "reservation" ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705844] mb-1">
                        Reservation ID / Booking Code
                      </label>
                      <input
                        type="text"
                        inputMode="text"
                        value={reservationIdInput}
                        onChange={(event) => { setReservationIdInput(event.target.value); setPromptError(null); }}
                        placeholder="e.g. 12 or JOHN3210"
                        className="w-full rounded-xl border border-[#D7C4A3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#B85B43]"
                      />
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#F4EDE0] border border-[#E0D3BF] text-[11px] text-[#705844] leading-relaxed">
                      <span className="font-bold text-[#B85B43]">Instruction:</span> Reservation ID is the first 4 letters of your name and last 4 numbers of your phone number (e.g. JOHN3210).
                    </div>
                    {promptError && <p className="text-xs text-rose-600 font-medium">{promptError}</p>}
                    <button
                      type="button"
                      onClick={continueFromReservationPrompt}
                      className="w-full rounded-xl bg-[#261C18] hover:bg-[#3D2D24] py-3 text-sm font-bold text-white transition-all shadow-sm active:scale-[0.98]"
                    >
                      Continue to menu
                    </button>
                  </div>
                ) : (
                  /* Option 2: Walk-in Guest Form (Name & Phone only) */
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705844]">
                          Your Name
                        </label>
                        <span className="text-[10px] text-stone-500 font-medium">Letters only</span>
                      </div>
                      <input
                        type="text"
                        autoComplete="name"
                        maxLength={60}
                        value={walkInName}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^a-zA-Z\s\.\'\-]/g, "");
                          setWalkInName(cleaned);
                          setPromptError(null);
                        }}
                        onBlur={() => {
                          setWalkInName((prev) =>
                            prev
                              .trim()
                              .replace(/\s+/g, " ")
                              .replace(/\b\w/g, (c) => c.toUpperCase())
                          );
                        }}
                        placeholder="e.g. Rajesh Sharma"
                        className="w-full rounded-xl border border-[#D7C4A3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#B85B43]"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-[#705844]">
                          Phone Number
                        </label>
                        {walkInCountryCode === "+91" ? (
                          walkInPhone.length === 10 && /^[6-9]\d{9}$/.test(walkInPhone) ? (
                            <span className="text-[10px] text-emerald-700 font-bold">✓ 10 digits</span>
                          ) : (
                            <span className="text-[10px] text-stone-500 font-medium">{walkInPhone.length}/10</span>
                          )
                        ) : (
                          walkInPhone.length >= 7 && walkInPhone.length <= 15 ? (
                            <span className="text-[10px] text-emerald-700 font-bold">✓ Valid</span>
                          ) : (
                            <span className="text-[10px] text-stone-500 font-medium">{walkInPhone.length}/7–15</span>
                          )
                        )}
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={walkInCountryCode}
                          onChange={(e) => {
                            setWalkInCountryCode(e.target.value);
                            setWalkInPhone("");
                            setPromptError(null);
                          }}
                          aria-label="Country Code"
                          className="px-2.5 py-2.5 rounded-xl border border-[#D7C4A3] bg-[#FAF7F2] text-xs font-bold text-[#140E0A] focus:outline-hidden focus:border-[#B85B43] transition-all cursor-pointer max-w-[120px] sm:max-w-[140px]"
                        >
                          {ALL_COUNTRY_CODES.map((c) => (
                            <option key={`${c.iso}-${c.code}`} value={c.code}>
                              {c.flag} {c.code} ({c.name})
                            </option>
                          ))}
                        </select>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={walkInCountryCode === "+91" ? 10 : 15}
                          autoComplete="tel-national"
                          value={walkInPhone}
                          onChange={(e) => {
                            let digits = e.target.value.replace(/\D/g, "");
                            if (walkInCountryCode === "+91") {
                              if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
                              else if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
                              if (digits.length > 10) digits = digits.slice(0, 10);
                            } else {
                              if (digits.length > 15) digits = digits.slice(0, 15);
                            }
                            setWalkInPhone(digits);
                            setPromptError(null);
                          }}
                          placeholder={walkInCountryCode === "+91" ? "e.g. 9876543210" : "Phone number"}
                          className="flex-1 rounded-xl border border-[#D7C4A3] bg-white px-3 py-2.5 text-sm font-mono tracking-wider font-semibold outline-hidden focus:border-[#B85B43]"
                        />
                      </div>
                    </div>
                    {promptError && <p className="text-xs text-rose-600 font-medium">{promptError}</p>}
                    <button
                      type="button"
                      disabled={isSubmittingWalkIn}
                      onClick={handleWalkInSubmit}
                      className="w-full rounded-xl bg-[#261C18] hover:bg-[#3D2D24] py-3 text-sm font-bold text-white transition-all shadow-sm disabled:opacity-50 active:scale-[0.98]"
                    >
                      {isSubmittingWalkIn ? "Connecting Table..." : "Enter Table & View Menu"}
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        {/* Quick Dine Active Banner */}
        {isQuickDineActive && reservationNotice && (
          <div className="mb-4 p-3.5 rounded-2xl bg-amber-500/15 border-2 border-amber-500/40 text-amber-950 flex items-center justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <span className="font-condensed font-bold text-sm uppercase text-amber-950 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-950" />
                  <span>Quick Dine Session Active</span>
                </span>
                <span className="text-xs text-amber-900">
                  Table reserved at {reservationNotice.time_slot} • Wrap up within{" "}
                  <span className="font-bold font-mono text-amber-800">
                    {quickDineMinutesLeft ?? reservationNotice.quick_dine_minutes} mins
                  </span>
                </span>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-amber-600 text-white font-mono font-bold text-xs shrink-0 animate-pulse">
              {quickDineMinutesLeft ?? reservationNotice.quick_dine_minutes}m left
            </span>
          </div>
        )}

        {/* Checked-In Welcome Banner */}
        {(checkInSuccess || (reservationNotice && reservationNotice.status === "SEATED")) && (
          <div className="mb-4 p-4 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/35 text-emerald-950 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-xs shrink-0 mt-0.5">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-condensed font-bold text-sm uppercase tracking-wider text-emerald-900">
                    Welcome, {reservationNotice?.customer_name || "Guest"}!
                  </span>
                  <span className="text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-900 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    CHECKED IN • SEATED
                  </span>
                </div>
                <p className="text-xs text-emerald-900/90 mt-1">
                  You are checked in at {reservationNotice?.table_name || tableNumber}. Your digital menu is unlocked — explore our wood-fired pizzas, starters, and beverages below!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Table Reservation Notice Banner (If not seated) */}
        {reservationNotice && reservationNotice.status !== "SEATED" && !checkInSuccess && (
          <div className="mb-4 p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500/35 text-amber-950 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-600 text-white rounded-xl shadow-xs shrink-0 mt-0.5">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-condensed font-bold text-sm uppercase tracking-wider text-amber-900">
                    TABLE RESERVED NOTICE
                  </span>
                  <span className="text-[10px] uppercase font-bold bg-amber-500/20 text-amber-900 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                    {reservationNotice.status}
                  </span>
                  {reservationNotice.floor_number && (
                    <span className="text-[10px] font-bold bg-[#261C18] text-white px-2 py-0.5 rounded-full">
                      {getFloorName(reservationNotice.floor_number)}
                    </span>
                  )}
                  {reservationNotice.table_name && (
                    <span className="text-[10px] font-bold bg-[#B85B43] text-white px-2 py-0.5 rounded-full">
                      {reservationNotice.table_name}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-[#261C18] mt-1.5">
                  This table is reserved for <span className="text-[#B85B43] font-bold">{reservationNotice.customer_name}</span> ({reservationNotice.guest_count} Guests) on {reservationNotice.reservation_date} at {reservationNotice.time_slot}.
                </p>

                {/* 3. 1-Tap Self Check-In via QR Scan */}
                {reservationNotice.allow_self_checkin && (
                  <div className="mt-3">
                    <button
                      onClick={handleSelfCheckIn}
                      disabled={isCheckingIn}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#261C18] hover:bg-[#B85B43] text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all"
                    >
                      {isCheckingIn ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Checking You In...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Are you {reservationNotice.customer_name}? [Tap to Check In & Start Ordering]</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* 4. Quick Dine Option for Walk-Ins */}
                {reservationNotice.can_quick_dine && !isQuickDineActive && (
                  <div className="mt-3 p-3 bg-amber-100/80 rounded-xl border border-amber-300/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950 uppercase tracking-wide">
                        <Clock className="w-4 h-4 text-amber-700" />
                        <span>Walk-in Quick Dine (Under {reservationNotice.quick_dine_minutes} mins)</span>
                      </div>
                      <p className="text-xs text-amber-900/90 mt-0.5">
                        This table is reserved in {reservationNotice.minutes_until_reservation} mins ({reservationNotice.time_slot}). Would you like a Quick Dine session (under {reservationNotice.quick_dine_minutes} mins)?
                      </p>
                    </div>
                    <button
                      onClick={handleAcceptQuickDine}
                      className="whitespace-nowrap px-3.5 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold uppercase tracking-wider transition shadow-2xs flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5 text-white" />
                      <span>Start Quick Dine</span>
                    </button>
                  </div>
                )}

                <p className="text-xs text-amber-900/70 mt-2">
                  If this is your reservation, tap check-in above. Walk-in guests can take a quick dine session or check with our floor manager for an unreserved table.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ================= ORDER SUCCESS CONFIRMATION MODAL & WARM NOTE ================= */}
        <AnimatePresence>
          {orderPlaced && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOrderPlaced(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              />

              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                className="relative w-full max-w-md rounded-3xl bg-[#FAF8F5] border border-[#DDD3C4] p-6 sm:p-7 shadow-2xl z-10 text-center space-y-4 max-h-[92vh] overflow-y-auto"
              >
                {/* Checkmark Badge */}
                <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#1B3618]/15 border-2 border-[#1B3618] text-[#1B3618] mx-auto shadow-xs">
                  <CheckCircle2 className="w-8 h-8 sm:w-9 sm:h-9 text-[#1B3618]" />
                </div>

                {/* Order ID Pill */}
                <div>
                  <span className="inline-block text-xs sm:text-sm font-mono tracking-widest text-[#9E3E26] uppercase font-bold bg-[#9E3E26]/10 px-4 py-1 rounded-full border border-[#9E3E26]/30">
                    ORDER #{lastOrderNum || "CONFIRMED"} • DISPATCHED TO KITCHEN
                  </span>
                </div>

                {/* Main Headline */}
                <h3 className="font-serif text-2xl sm:text-3xl font-bold text-[#140E0A]">
                  Your Order is Sizzling in the Oven!
                </h3>

                {/* Warm Note Box - High Contrast, Large Readable Font */}
                <div className="bg-[#F2ECE1] border border-[#DDD3C4] rounded-2xl p-5 sm:p-6 text-center shadow-xs">
                  <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-md bg-white border border-[#DDD3C4] text-xs font-sans font-bold uppercase tracking-wider text-[#9E3E26] mb-3 shadow-2xs">
                    <HeartHandshake className="w-4 h-4 text-[#9E3E26]" />
                    <span>A WARM NOTE FROM OUR TEAM</span>
                  </div>

                  <p className="font-serif text-sm sm:text-base text-[#140E0A] leading-relaxed font-semibold">
                    “Please feel free to settle your bill at our reception counter whenever you wrap up. We invite you to pay at the counter not just for the bill, but because we genuinely love to meet, smile with, and thank the wonderful people who grace Jaadoo Pizza Project with their presence.”
                  </p>

                  <p className="text-xs sm:text-sm font-sans font-medium text-[#1B3618] mt-3">
                    You are never just a table number to us; you are our guest. Savor every bite!
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setOrderPlaced(false)}
                    className="w-full py-3.5 rounded-full bg-[#261C18] hover:bg-[#B85B43] text-[#FBF9F5] text-xs sm:text-sm font-sans font-bold uppercase tracking-wider shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    GOT IT, THANK YOU!
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderPlaced(false);
                      fetchBill();
                    }}
                    className="w-full py-3.5 rounded-full bg-white hover:bg-[#F3ECE1] text-[#261C18] text-xs sm:text-sm font-sans font-bold uppercase tracking-wider border-2 border-[#DECFC0] shadow-xs hover:shadow-sm transition-all cursor-pointer"
                  >
                    VIEW RUNNING TAB
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Sticky Category Navigation Filter */}
        <nav aria-label="Menu categories" className="sticky top-[62px] sm:top-16 z-30 -mx-4 mb-10 border-y border-[#D7C4A3] bg-[#F7EBD5]/95 py-3 backdrop-blur-md sm:-mx-6">
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 sm:px-6">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
                selectedCategory === "all"
                  ? "border-[#9E3E26] text-[#9E3E26]"
                  : "border-transparent text-[#49382D] hover:border-[#BFA47A]"
              }`}
            >
              ALL DISHES
            </button>
            {liveMenuData.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
                  selectedCategory === c.id
                    ? "border-[#9E3E26] text-[#9E3E26]"
                    : "border-transparent text-[#49382D] hover:border-[#BFA47A]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </nav>

        {/* Category Sections & Items List */}
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
          {(selectedCategory === "all"
            ? liveMenuData
            : liveMenuData.filter((c) => c.id === selectedCategory)
          ).map((category) => {
            const isCompactDrinks = category.id === "beverages" || category.id === "hot-drinks";
            return (
            <section id={category.id} key={category.id} className={category.id === "pizza" ? "lg:col-span-2" : ""}>
              {/* Category Header */}
              <div className="mb-2 flex items-center gap-3 border-b-2 border-[#17251A] pb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#9E3E26] text-[#9E3E26]">
                  {categoryIcons[category.id] || <Utensils className="w-3.5 h-3.5 text-[#9E3E26]" />}
                </div>
                <h2 className="font-serif text-2xl font-bold text-[#17251A] sm:text-3xl">
                  {category.name}
                </h2>
              </div>

              {/* Menu Items */}
              <div className={isCompactDrinks ? "grid grid-cols-2 gap-x-5 sm:gap-x-8" : category.id === "pizza" ? "grid gap-x-10 md:grid-cols-2" : ""}>
                {category.items.map((item) => {
                  const isAvailable = (item as any).is_available !== false;
                  const qtyInCart = cart[item.id]?.qty || 0;
                  const itemMedia = ITEM_MEDIA_MAP[item.id];
                  const imgUrl = item.image_url || itemMedia?.image_url || "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80";

                  const isPizza = item.id.startsWith("pz") || category.id === "pizza";

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (isAvailable && qtyInCart === 0) updateCart(item, 1);
                      }}
                      className={`group transition-all ${isCompactDrinks ? "flex min-h-32 flex-col justify-between border-b border-[#D9C9AE] py-3" : "grid grid-cols-[64px_minmax(0,1fr)_84px] gap-3 border-b border-[#D9C9AE] py-4 sm:grid-cols-[96px_minmax(0,1fr)_96px] sm:gap-5"} ${
                        !isAvailable
                          ? "cursor-not-allowed opacity-50"
                          : qtyInCart > 0
                          ? "bg-[#FFF3DD] cursor-pointer"
                          : "cursor-pointer"
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className={`${isCompactDrinks ? "hidden" : "flex"} relative aspect-square overflow-hidden rounded-full border border-[#CDBB9C] bg-[#EFE5D3]`}>
                        <img
                          src={imgUrl}
                          alt={item.name}
                          className={`w-full h-full object-cover transition-transform duration-300 ${isPizza ? "scale-140 group-hover:scale-155" : "group-hover:scale-110"} ${!isAvailable ? "grayscale" : ""}`}
                          loading="lazy"
                        />
                      </div>

                      {/* Details */}
                      <div className={`min-w-0 ${isCompactDrinks ? "w-full" : "self-center"}`}>
                        <div className={`${isCompactDrinks ? "hidden" : "flex"} items-center gap-1.5 mb-1 flex-wrap`}>
                          {!isAvailable && (
                            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full inline-block border border-rose-300">
                              Sold Out
                            </span>
                          )}
                        </div>
                        <h3
                          className={`font-serif font-bold leading-snug break-words whitespace-normal transition-colors ${isCompactDrinks ? "text-[13px] sm:text-base" : "text-base sm:text-lg"} ${
                            isAvailable
                              ? "text-[#140E0A] group-hover:text-[#9E3E26]"
                              : "text-stone-500 line-through"
                          }`}
                        >
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className={`mt-1 break-words whitespace-normal italic leading-relaxed text-[#5B4A3E] ${isCompactDrinks ? "text-xs" : "text-sm"}`}>
                            ({item.description})
                          </p>
                        )}
                      </div>

                      {/* Price & Add Controls */}
                      <div className={isCompactDrinks ? "mt-3 flex w-full items-center justify-between" : "flex w-[84px] shrink-0 flex-col items-end self-center sm:w-[96px]"}>
                        <span
                          className={`mb-1.5 text-right font-sans text-base font-bold ${
                            isAvailable ? "text-[#140E0A]" : "text-stone-400"
                          }`}
                        >
                          ₹{item.price}
                        </span>

                        {!isAvailable ? (
                          <span className="px-3 py-1 rounded-full bg-stone-200 text-stone-500 text-[10px] font-sans font-bold uppercase tracking-wider">
                            Unavailable
                          </span>
                        ) : qtyInCart === 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateCart(item, 1);
                            }}
                            className="px-4 py-1.5 rounded-full bg-[#140E0A] hover:bg-[#9E3E26] text-[#FAF8F5] text-xs font-sans font-bold uppercase tracking-wider shadow-2xs transition-all cursor-pointer touch-manipulation select-none active:scale-95 min-h-[34px]"
                          >
                            ADD
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5 bg-[#140E0A] text-[#FAF8F5] rounded-full px-2 py-1 shadow-xs">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCart(item, -1);
                              }}
                              className="w-7 h-7 rounded-full hover:bg-[#9E3E26] active:bg-[#9E3E26] flex items-center justify-center transition cursor-pointer touch-manipulation select-none active:scale-90"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-mono font-bold text-xs px-1 min-w-[18px] text-center">
                              {qtyInCart}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCart(item, 1);
                              }}
                              className="w-7 h-7 rounded-full hover:bg-[#9E3E26] active:bg-[#9E3E26] flex items-center justify-center transition cursor-pointer touch-manipulation select-none active:scale-90"
                              aria-label="Increase quantity"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            );
          })}
        </div>
      </main>

      {/* Floating Bottom Bar: Review & Send Order */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-5 left-4 right-4 z-40 max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => setShowCartDrawer(true)}
            className="w-full py-3.5 px-5 rounded-2xl bg-[#261C18] hover:bg-[#B85B43] text-[#FBF9F5] font-bold text-sm uppercase tracking-wider shadow-xl flex items-center justify-between transition-all transform active:scale-[0.99] touch-manipulation select-none cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-[#FBF9F5] text-[#261C18] flex items-center justify-center font-mono font-black text-xs">
                {totalCartCount}
              </span>
              <span>CONFIRM ORDER</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-base font-bold">₹{totalCartPrice}</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* Cart Review Drawer */}
      <AnimatePresence>
        {showCartDrawer && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCartDrawer(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-md bg-[#FBF9F5] border-l border-[#E4DCD0] text-[#261C18] h-full p-6 flex flex-col justify-between overflow-y-auto"
            >
              <div>
                <div className="flex items-center justify-between border-b border-[#E4DCD0] pb-4">
                  <div className="flex items-center gap-2">
                    <UtensilsCrossed className="w-5 h-5 text-[#B85B43]" />
                    <h2 className="font-bold text-lg text-[#261C18] uppercase font-serif">
                      {tableNumber} ORDER
                    </h2>
                  </div>
                  <button
                    onClick={() => setShowCartDrawer(false)}
                    className="p-1.5 rounded-full hover:bg-[#E4DCD0]/50 text-stone-600 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Items in Cart */}
                <div className="py-5 space-y-3">
                  {Object.values(cart).map(({ item, qty }) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-white border border-[#E4DCD0] flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className="font-serif font-bold text-sm text-[#261C18] break-words whitespace-normal">{item.name}</h4>
                        <span className="text-xs text-[#B85B43] font-mono font-bold">
                          ₹{item.price} × {qty}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#FBF9F5] border border-[#E4DCD0] rounded-lg p-1">
                        <button
                          onClick={() => updateCart(item, -1)}
                          className="p-1 hover:bg-[#E4DCD0]/50 text-[#261C18] rounded"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono font-bold text-xs text-[#261C18] px-2">
                          {qty}
                        </span>
                        <button
                          onClick={() => updateCart(item, 1)}
                          className="p-1 hover:bg-[#E4DCD0]/50 text-[#261C18] rounded"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Optional Allergy & Dietary Info Input */}
                <div className="mb-4 p-3.5 rounded-2xl bg-white border border-[#E4DCD0] shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="allergy-info-input" className="flex items-center gap-1.5 text-xs font-bold text-[#261C18] uppercase tracking-wider font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#B85B43]" />
                      <span>Allergy / Dietary Info</span>
                    </label>
                    <span className="text-[10px] font-mono text-stone-500 uppercase font-semibold bg-[#F5EFE6] px-1.5 py-0.5 rounded border border-[#E4DCD0]">
                      Optional
                    </span>
                  </div>
                  <textarea
                    id="allergy-info-input"
                    value={allergyInfo}
                    onChange={(e) => setAllergyInfo(e.target.value)}
                    rows={2}
                    placeholder="E.g., Nut allergy, lactose intolerant, Jain preparation, no garlic/onion, gluten sensitive..."
                    maxLength={400}
                    className="w-full text-xs p-2.5 rounded-xl border border-[#DDD3C4] bg-[#FBF9F5] text-[#261C18] placeholder:text-stone-400 focus:outline-none focus:border-[#B85B43] focus:ring-1 focus:ring-[#B85B43] resize-none"
                  />
                  <p className="text-[10px] text-stone-500 leading-tight">
                    This note will be printed directly on the kitchen ticket (KOT) for our chef.
                  </p>
                </div>
              </div>

              {/* Cart Footer */}
              <div className="border-t border-[#E4DCD0] pt-4 space-y-3">
                <div className="flex items-center justify-between font-bold">
                  <span className="text-stone-500 uppercase text-xs tracking-wider">Subtotal</span>
                  <span className="text-[#B85B43] font-mono text-lg">₹{totalCartPrice}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-stone-500">
                  <span>GST (5% · excluded from menu prices)</span>
                  <span className="font-mono">₹{cartTax.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[#E4DCD0] pt-2 font-bold">
                  <span className="uppercase text-xs tracking-wider">Total with GST</span>
                  <span className="text-[#B85B43] font-mono text-lg">₹{cartGrandTotal.toFixed(2)}</span>
                </div>

                <button
                  onClick={handleSendOrderToKitchen}
                  className="w-full py-3.5 rounded-xl bg-[#261C18] hover:bg-[#B85B43] text-[#FBF9F5] font-bold text-sm uppercase tracking-wider shadow-md transition flex items-center justify-center gap-2"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>SEND ORDER TO KITCHEN</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Live Running Bill Modal */}
      <AnimatePresence>
        {showBillModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBillModal(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-xs"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md rounded-3xl bg-[#FBF9F5] border border-[#E4DCD0] p-6 shadow-2xl z-10 text-[#261C18]"
            >
              <div className="flex items-center justify-between border-b border-[#E4DCD0] pb-3.5">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-[#B85B43]" />
                  <h3 className="font-bold text-lg text-[#261C18] uppercase font-serif">
                    {tableNumber} • RUNNING BILL
                  </h3>
                </div>
                <button
                  onClick={() => setShowBillModal(false)}
                  className="p-1.5 rounded-full hover:bg-[#E4DCD0]/50 text-stone-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingBill ? (
                <div className="py-12 text-center text-[#B85B43] font-mono text-xs font-bold">
                  FETCHING LIVE BILL DETAILS...
                </div>
              ) : (
                <div className="py-5 space-y-4 font-mono text-xs text-[#140E0A]">
                  <div className="flex justify-between border-b border-[#DDD3C4] pb-2 font-bold">
                    <span>Session Status:</span>
                    <span className="text-[#1B3618] bg-[#E2EDDE] px-2 py-0.5 rounded border border-[#B5CEAE]">{billData?.status || "ACTIVE"}</span>
                  </div>

                  {/* Allergy / Dietary Note if present */}
                  {billData?.allergy_info && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-600/30 text-[#261C18] text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-amber-900 block uppercase text-[10px] tracking-wide font-sans">
                          Allergy / Dietary Note:
                        </span>
                        <span className="text-stone-800 break-words whitespace-normal text-xs font-sans">
                          {billData.allergy_info}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Dispatched items */}
                  {billData?.items && billData.items.length > 0 ? (
                    <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                      {billData.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between items-start text-[#140E0A] font-medium text-xs gap-2">
                          <span className="flex-1 min-w-0 break-words whitespace-normal">
                            <strong className="font-bold">{it.quantity}×</strong> {it.name}
                          </span>
                          <span className="font-extrabold text-[#140E0A] shrink-0">₹{it.total}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[#3B2C23] italic text-xs py-4 text-center font-sans">
                      No items ordered yet for this table.
                    </div>
                  )}

                  <div className="border-t border-[#DDD3C4] pt-3 space-y-1.5 text-xs text-[#140E0A]">
                    <div className="flex justify-between font-medium">
                      <span>Subtotal:</span>
                      <span className="font-bold">₹{billData?.subtotal.toFixed(2) || "0.00"}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>GST ({( (billData?.tax_rate || 0.05) * 100 ).toFixed(0)}% · excluded from menu prices):</span>
                      <span className="font-bold">₹{billData?.tax_amount.toFixed(2) || "0.00"}</span>
                    </div>
                    <div className="flex justify-between text-[#9E3E26] font-extrabold text-base pt-2.5 border-t border-[#DDD3C4]">
                      <span>GRAND TOTAL:</span>
                      <span>₹{billData?.grand_total.toFixed(2) || "0.00"}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[#4A5842]/10 border border-[#4A5842]/20 text-[#261C18] text-xs leading-relaxed flex items-start gap-2">
                <Info className="w-4 h-4 text-[#4A5842] shrink-0 mt-0.5" />
                <p>
                  Please pay when you leave at the counter.
                </p>
              </div>

              <button
                onClick={() => setShowBillModal(false)}
                className="w-full mt-4 py-3 rounded-xl bg-[#261C18] hover:bg-[#B85B43] text-[#FBF9F5] font-bold text-xs uppercase tracking-wider transition"
              >
                Close Bill View
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
