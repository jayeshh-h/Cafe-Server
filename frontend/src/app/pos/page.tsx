"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import BrandTitle from "@/components/BrandTitle";
import { motion } from "framer-motion";
import {
  Clock,
  Printer,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Receipt,
  Users,
  UtensilsCrossed,
  Flame,
  Check,
  RotateCw,
  Volume2,
  VolumeX,
  ArrowLeft,
  ChevronDown,
  Lock,
  LogOut,
  ShieldCheck,
  Calendar,
  UserCheck,
  XCircle,
  X,
  Phone,
  Mail,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Smartphone,
  Banknote,
  Eye,
  EyeOff,
  Layers,
  Sparkles,
  Search,
} from "lucide-react";
import { RESTAURANT_FLOORS, RESTAURANT_TABLES, getTableFloor, getFloorName } from "@/data/floors";
import { formatBookingId } from "@/lib/bookingId";
import { posSession } from "@/lib/authFetch";
import { toast } from "@/components/ui/toast";
import { billEscPos, kotTicketEscPos } from "@/lib/escpos";
import TakeOrderModal from "@/components/pos/TakeOrderModal";

const {
  fetch: posFetch,
  tokenKey: POS_TOKEN_KEY,
  refreshKey: POS_REFRESH_KEY,
  expiredEvent: POS_SESSION_EXPIRED,
  refreshedEvent: POS_TOKEN_REFRESHED,
} = posSession;

// Max discount any staff member (admin or cashier) can give; the backend enforces the same cap.
const MAX_DISCOUNT_PERCENT = 10;

function SettleDiscountControl({
  session,
  token,
  onApplied,
}: {
  session: TableSession;
  token: string;
  onApplied: (update: Partial<TableSession>) => void;
}) {
  const [type, setType] = useState<"PERCENT" | "FLAT">(session.discount_type || "PERCENT");
  const [value, setValue] = useState(session.discount_type ? String(Number(session.discount_value || 0)) : "");
  const [reason, setReason] = useState(session.discount_reason || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = Number(session.subtotal || session.total_amount || 0);
  const maxFlat = Math.floor(subtotal * MAX_DISCOUNT_PERCENT) / 100;
  const hasDiscount = Number(session.discount_amount || 0) > 0;

  const submit = async (clear: boolean) => {
    const num = Number(value);
    if (!clear) {
      if (!value || !Number.isFinite(num) || num <= 0) return setError("Enter a discount greater than zero.");
      if (type === "PERCENT" && num > MAX_DISCOUNT_PERCENT) return setError(`Maximum discount is ${MAX_DISCOUNT_PERCENT}%.`);
      if (type === "FLAT" && num > maxFlat) return setError(`Maximum discount on this bill is ₹${maxFlat.toFixed(2)}.`);
    }
    setBusy(true);
    setError(null);
    try {
      const res = await posFetch(`/api/v1/pos/sessions/${session.session_id}/discount`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(clear ? { discount_type: null } : { discount_type: type, discount_value: num, reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail.replace(/^[A-Z_]+: /, "") : "Could not apply discount.");
        return;
      }
      if (clear) {
        setValue("");
        setReason("");
      }
      onApplied({
        subtotal: Number(data.subtotal),
        discount_type: data.discount_type,
        discount_value: Number(data.discount_value),
        discount_amount: Number(data.discount_amount),
        discount_reason: data.discount_reason,
        tax_amount: Number(data.tax_amount),
        gross_amount: Number(data.gross_amount),
        reservation_credit: Number(data.reservation_credit),
        net_amount_due: Number(data.net_amount_due),
      });
    } catch {
      setError("Network error applying discount.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 font-sans text-xs">
      <label className="font-bold text-stone-700 uppercase tracking-wider block">
        Discount <span className="normal-case font-semibold text-stone-500">(max {MAX_DISCOUNT_PERCENT}%, before GST)</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-[#F6F3EC] p-0.5">
          {(["PERCENT", "FLAT"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`px-2.5 py-1.5 rounded-md font-bold cursor-pointer ${type === t ? "bg-[#261C18] text-white" : "text-stone-700"}`}
            >
              {t === "PERCENT" ? "%" : "₹"}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="0"
          step={type === "PERCENT" ? "0.5" : "1"}
          max={type === "PERCENT" ? MAX_DISCOUNT_PERCENT : maxFlat}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={type === "PERCENT" ? `Up to ${MAX_DISCOUNT_PERCENT}` : `Up to ${maxFlat.toFixed(0)}`}
          aria-label="Discount value"
          className="w-24 px-2.5 py-1.5 rounded-lg border border-[#E4DCD0] bg-white outline-none focus:border-[#261C18]"
        />
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-[#261C18] text-white font-bold cursor-pointer disabled:opacity-50"
        >
          {busy ? "…" : "Apply"}
        </button>
        {hasDiscount && (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-bold cursor-pointer disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="Reason (optional), e.g. regular guest"
        aria-label="Discount reason"
        className="w-full px-2.5 py-1.5 rounded-lg border border-[#E4DCD0] bg-white outline-none focus:border-[#261C18]"
      />
      {error && <p className="text-rose-700 font-semibold">{error}</p>}
    </div>
  );
}

interface SessionItem {
  menu_item_id?: number | null; // sent back by Edit Bill so same-named dishes are never mixed up
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  special_instructions?: string;
}

interface TableSession {
  session_id: number;
  session_seq: number;
  session_token: string;
  status: string;
  opened_at: string;
  closed_at?: string;
  customer_name?: string;
  total_amount: number;
  items_count: number;
  is_active: boolean;
  is_settled: boolean;
  items: SessionItem[];
  reservation_id?: number;
  subtotal?: number;
  tax_amount?: number;
  gross_amount?: number;
  reservation_deposit_paid?: number;
  reservation_credit?: number;
  net_amount_due?: number;
  remainder_action?: string;
  remainder_amount?: number;
  discount_type?: "PERCENT" | "FLAT" | null;
  discount_value?: number;
  discount_amount?: number;
  discount_reason?: string | null;
  allergy_info?: string | null;
}

interface TableOverview {
  table_id: number;
  table_number: string;
  capacity: number;
  status: string;
  active_session_count: number;
  total_sessions_today: number;
  sessions: TableSession[];
  floor_number?: number;
  floor_name?: string;
  floor_table_num?: number;
}

interface KOTItem {
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  special_instructions?: string;
}

interface KOT {
  id: number;
  kot_number: string;
  sequence_number: number;
  business_date: string;
  table_number: string;
  table_id: number;
  dining_session_id: number;
  order_id: number;
  order_number: string;
  total_amount: number;
  items_count: number;
  status: string;
  printed_status: string;
  allergy_info?: string | null;
  created_at: string;
  items: KOTItem[];
  print_job_id?: number;
}

interface ItemSummary {
  name: string;
  quantity: number;
}

interface CategorySummary {
  category: string;
  quantity: number;
}

interface DailyDoughCapacity {
  branch_id?: number;
  production_date?: string;
  total_dough_limit: number | null;
  total_allocated_dough: number;
  total_active_protected: number;
  walk_in_available: number | null;
  note?: string;
}

interface POSSummary {
  business_date: string;
  total_kots: number;
  tables_served: number;
  total_items: number;
  avg_items_per_kot: number;
  avg_kot_value: number;
  kots_per_hour: number;
  peak_hour: string;
  item_summary: ItemSummary[];
  category_summary: CategorySummary[];
  comparison: {
    today?: { kots: number; pizzas: number; pasta: number; beverages: number };
    yesterday?: { kots: number; pizzas: number; pasta: number; beverages: number };
  };
}

interface Customer {
  id: number;
  name: string;
  phone: string;
  email?: string;
}

interface Reservation {
  id: number;
  branch_id: number;
  customer_id: number;
  guest_count: number;
  reservation_date: string;
  time_slot: string;
  status: string;
  payment_status?: string;
  advance_amount?: number;
  payment_reference?: string;
  payment_method?: string;
  table_id?: number;
  floor_number?: number;
  table_name?: string;
  booking_id?: string;
  is_deposit_credited?: boolean;
  credited_bill_id?: number;
  created_at: string;
  customer?: Customer;
}

interface PendingPaymentReview {
  credit_id: number;
  utr: string;
  amount: number;
  merchant_vpa: string;
  provider_source: string;
  status: string;
  review_reason: string;
  raw_event_payload?: string;
  verified_at: string;
}

// ---------------------------------------------------------------------------
// KOT printing from this browser (USB / network / Bluetooth printer installed on the device).
// Silent printing needs Chrome started with --kiosk-printing; otherwise the print dialog shows.
// ---------------------------------------------------------------------------
type KotTicket = {
  kot_id: number;
  kot_number: string;
  table_id: number;
  table_number: string | null;
  order_number: string | null;
  allergy_info?: string | null;
  created_at: string;
  items: { name: string; quantity: number; special_instructions?: string | null }[];
};

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Server timestamps are naive UTC; mark them as UTC so the local time is right
const parseServerTime = (iso: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);

// Direct printing to a thermal printer with no computer driver (Bluetooth / USB serial),
// via the browser's Web Serial support (Chrome and Edge on Windows / Mac).
type SerialPrinterPort = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};
type WebSerial = {
  requestPort(): Promise<SerialPrinterPort>;
  getPorts(): Promise<SerialPrinterPort[]>;
};
const getWebSerial = (): WebSerial | null =>
  typeof navigator !== "undefined" && "serial" in navigator ? (navigator as unknown as { serial: WebSerial }).serial : null;

function kotTicketForPrinter(t: KotTicket, paperMm: 58 | 80): Uint8Array {
  const floor = getTableFloor(t.table_id);
  return kotTicketEscPos(
    {
      kotNumber: t.kot_number,
      tableLine: `${floor.name} - TABLE ${floor.floor_table_num}`,
      time: parseServerTime(t.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      orderNumber: t.order_number,
      allergyInfo: t.allergy_info,
      items: t.items,
    },
    paperMm
  );
}

function kotTicketHtml(t: KotTicket, paperMm: number): string {
  const floor = getTableFloor(t.table_id);
  const time = parseServerTime(t.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const big = paperMm >= 80 ? 22 : 18;
  const rows = t.items
    .map(
      (it) => `<tr><td class="q">${escapeHtml(it.quantity)} ×</td><td class="n">${escapeHtml(it.name)}${
        it.special_instructions ? `<div class="note">» ${escapeHtml(it.special_instructions)}</div>` : ""
      }</td></tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t.kot_number)}</title><style>
    @page { size: ${paperMm}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    body { margin: 0; width: ${paperMm - 4}mm; font-family: "Courier New", monospace; color: #000; font-size: 13px; }
    .c { text-align: center; } .kot { font-size: ${big}px; font-weight: 800; margin: 2px 0; }
    .tbl { font-size: ${big - 4}px; font-weight: 800; } .muted { font-size: 11px; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 3px 0; }
    .q { width: 34px; font-weight: 800; font-size: 15px; } .n { font-weight: 700; font-size: 15px; }
    .note { font-weight: 400; font-size: 12px; font-style: italic; }
    .allergy-box { border: 2px solid #000; padding: 4px; margin: 6px 0; text-align: center; font-size: 13px; font-weight: 800; background: #fff; }
  </style></head><body>
    <div class="c muted">JAADOO · KITCHEN ORDER</div>
    <div class="c kot">${escapeHtml(t.kot_number)}</div>
    <div class="c tbl">${escapeHtml(floor.name)} · TABLE ${escapeHtml(floor.floor_table_num)}</div>
    <div class="c muted">${escapeHtml(time)}${t.order_number ? ` · ${escapeHtml(t.order_number)}` : ""}</div>
    ${t.allergy_info ? `<div class="allergy-box">⚠️ ALLERGY / DIETARY INFO:<br>${escapeHtml(t.allergy_info.toUpperCase())}</div>` : ""}
    <hr><table>${rows}</table><hr>
    <div class="c muted">${t.items.reduce((n, it) => n + Number(it.quantity || 0), 0)} item(s)</div>
  </body></html>`;
}

// Print an HTML document. Auto-print uses a hidden iframe; a manual print passes a visible
// window (opened on the tap) so staff see the ticket and the full print dialog.
function printHtml(html: string, target?: Window | null): Promise<void> {
  return new Promise((resolve, reject) => {
    let iframe: HTMLIFrameElement | null = null;
    let win: Window | null = target ?? null;
    if (!win) {
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(iframe);
      win = iframe.contentWindow;
    }
    if (!win) {
      iframe?.remove();
      reject(new Error("no print frame"));
      return;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (target) target.close();
      else setTimeout(() => iframe?.remove(), 1000);
      resolve();
    };
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.onafterprint = done;
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (e) {
        if (target) target.close();
        else iframe?.remove();
        reject(e);
        return;
      }
      if (target) {
        // Manual: wait until the dialog is done (afterprint) or staff close the window
        const watch = setInterval(() => {
          if (target.closed) {
            clearInterval(watch);
            done();
          }
        }, 500);
      } else {
        setTimeout(done, 1500); // some browsers never fire afterprint
      }
    }, 250);
  });
}

// Gap between KOTs printed one after another (e.g. the pizza KOT, then the other KOT)
const KOT_PRINT_GAP_MS = 14_000;

export default function POSDashboard() {
  const [activeTab, setActiveTab] = useState<"tables" | "kots" | "reservations">("tables");

  // Table Sessions State
  const [tableOverviews, setTableOverviews] = useState<TableOverview[]>([]);
  const [takeOrder, setTakeOrder] = useState<{ tableId: number | null } | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Record<number, boolean>>({});
  const [showClosedToday, setShowClosedToday] = useState<Record<number, boolean>>({});
  const [tableFilter, setTableFilter] = useState<"all" | "active" | "available">("all");
  const [floorFilter, setFloorFilter] = useState<number | "all">("all");

  // Authentication State
  const [posToken, setPosToken] = useState<string | null>(null);
  const [staffUser, setStaffUser] = useState<{ id: number; username: string; role?: { name: string } } | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loginUsername, setLoginUsername] = useState("Jaadoo");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // KOT & Summary State
  const [kots, setKots] = useState<KOT[]>([]);
  const [summary, setSummary] = useState<POSSummary | null>(null);
  const [filter, setFilter] = useState<"all" | "failed" | "printed" | "pending">("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [isConnected, setIsConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Record<number, boolean>>({});
  const [closingSessionIds, setClosingSessionIds] = useState<Record<number, boolean>>({});
  const [soundEnabled, setSoundEnabled] = useState(true);

  // KOT auto-print: a per-device setting (only the device wired to the kitchen printer turns it on)
  // Read once on the client; the header with these controls only renders after login
  const readSetting = (key: string) => {
    try {
      return typeof window !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const [autoPrintKots, setAutoPrintKots] = useState(() => readSetting("jaadoo_kot_autoprint") === "on");
  const [kotPaperMm, setKotPaperMm] = useState<80 | 58>(() => (readSetting("jaadoo_kot_paper") === "80" ? 80 : 58)); // 58mm: the café's printer
  const autoPrintRef = useRef(false);
  const printQueueRef = useRef<Promise<void>>(Promise.resolve());
  const printingIdsRef = useRef<Set<number>>(new Set());
  const enqueueKotPrintRef = useRef<(kotId: number, force?: boolean) => void>(() => {});

  useEffect(() => {
    autoPrintRef.current = autoPrintKots;
  }, [autoPrintKots]);

  // Thermal printer connected straight to this device (no driver needed)
  const serialPortRef = useRef<SerialPrinterPort | null>(null);
  const [serialPrinter, setSerialPrinter] = useState<"unsupported" | "off" | "connecting" | "on">(() =>
    !getWebSerial() ? "unsupported" : readSetting("jaadoo_kot_serial") === "on" ? "connecting" : "off"
  );

  const openSerialPrinter = async (port: SerialPrinterPort) => {
    try {
      await port.open({ baudRate: 9600 }); // Bluetooth serial ignores the speed; 9600 suits USB models
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "InvalidStateError")) throw e; // already open is fine
    }
    serialPortRef.current = port;
    setSerialPrinter("on");
  };

  // Reconnect the printer chosen earlier, without asking again
  useEffect(() => {
    const serial = getWebSerial();
    if (!serial || readSetting("jaadoo_kot_serial") !== "on") return;
    serial
      .getPorts()
      .then((ports) => (ports[0] ? openSerialPrinter(ports[0]) : setSerialPrinter("off")))
      .catch(() => setSerialPrinter("off")); // printer switched off / out of range: stay on normal printing
  }, []);

  const connectSerialPrinter = async () => {
    const serial = getWebSerial();
    if (!serial) return;
    try {
      const port = await serial.requestPort();
      setSerialPrinter("connecting");
      await openSerialPrinter(port);
      try { localStorage.setItem("jaadoo_kot_serial", "on"); } catch {}
      toast.success("Printer connected. KOTs will print straight to it.");
    } catch (e) {
      setSerialPrinter("off");
      if (!(e instanceof DOMException && e.name === "NotFoundError")) {
        toast.error("Could not connect to the printer. Make sure it is switched on, paired, and not connected to a phone.");
      }
    }
  };

  const disconnectSerialPrinter = async () => {
    const port = serialPortRef.current;
    serialPortRef.current = null;
    setSerialPrinter("off");
    try { localStorage.setItem("jaadoo_kot_serial", "off"); } catch {}
    try { await port?.close(); } catch {}
  };

  const writeToSerialPrinter = async (bytes: Uint8Array) => {
    const port = serialPortRef.current;
    if (!port?.writable) throw new Error("printer not connected");
    const writer = port.writable.getWriter();
    try {
      await writer.write(bytes);
    } catch (e) {
      serialPortRef.current = null; // connection dropped: fall back to normal printing until reconnected
      setSerialPrinter("off");
      throw e;
    } finally {
      writer.releaseLock();
    }
  };
  const [lastNotification, setLastNotification] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string>("");

  // Daily Dough Capacity State
  const [doughCapacity, setDoughCapacity] = useState<DailyDoughCapacity | null>(null);
  const [isLoadingDoughCapacity, setIsLoadingDoughCapacity] = useState(false);

  // Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }).toUpperCase()
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const [isResettingAll, setIsResettingAll] = useState(false);

  // Walk-in Portal State
  const [isWalkInModalOpen, setIsWalkInModalOpen] = useState(false);
  const [walkInTableId, setWalkInTableId] = useState<number | null>(null);
  const [walkInGuestName, setWalkInGuestName] = useState("");
  const [walkInGuestCount, setWalkInGuestCount] = useState<number>(2);
  const [isSeatingWalkIn, setIsSeatingWalkIn] = useState(false);

  // Merge Table State
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeSourceTableId, setMergeSourceTableId] = useState<number | null>(null);
  const [mergeTargetTableId, setMergeTargetTableId] = useState<number | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Bill Modals State
  const [billPreviewSession, setBillPreviewSession] = useState<TableSession | null>(null);
  const [billPreviewTableInfo, setBillPreviewTableInfo] = useState<{ tableNumber: string; floorName: string; tableId: number } | null>(null);

  const [billEditSession, setBillEditSession] = useState<TableSession | null>(null);
  const [billEditTableInfo, setBillEditTableInfo] = useState<{ tableNumber: string; floorName: string; tableId: number } | null>(null);
  const [billEditItems, setBillEditItems] = useState<SessionItem[]>([]);
  const [isSavingBillEdit, setIsSavingBillEdit] = useState(false);

  const [billSettleSession, setBillSettleSession] = useState<TableSession | null>(null);
  const [billSettleTableInfo, setBillSettleTableInfo] = useState<{ tableNumber: string; floorName: string; tableId: number } | null>(null);
  const [settlePaymentMode, setSettlePaymentMode] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [printBillPaymentModal, setPrintBillPaymentModal] = useState<{
    session: TableSession;
    tableNumber: string;
    floorName: string;
  } | null>(null);

  // Reservations State
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isRefreshingRes, setIsRefreshingRes] = useState(false);
  const [resFilter, setResFilter] = useState<"all" | "CONFIRMED" | "ARRIVED" | "SEATED" | "COMPLETED" | "CANCELLED">("all");
  const [resSearch, setResSearch] = useState("");
  const [resDate, setResDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [updatingResId, setUpdatingResId] = useState<number | null>(null);
  const [pendingReviews, setPendingReviews] = useState<PendingPaymentReview[]>([]);
  const [assigningTableRes, setAssigningTableRes] = useState<Reservation | null>(null);
  const [selectedAssignTableId, setSelectedAssignTableId] = useState<number>(1);
  const [verifiedResIds, setVerifiedResIds] = useState<Record<number, boolean>>({});
  const [showNeedsAttention, setShowNeedsAttention] = useState<boolean>(true);

  // Reservation Verification Search & Table Allotment Modal State
  const [resVerifySearch, setResVerifySearch] = useState<string>("");
  const [resVerifyFilter, setResVerifyFilter] = useState<"all" | "unverified" | "verified">("all");
  const [verifyingRes, setVerifyingRes] = useState<Reservation | null>(null);
  const [verifySelectedTableId, setVerifySelectedTableId] = useState<number>(1);
  const [isVerifyingAndAllotting, setIsVerifyingAndAllotting] = useState<boolean>(false);

  const handleVerifyReservation = (resId: number) => {
    setVerifiedResIds((prev) => ({ ...prev, [resId]: true }));
    setLastNotification(`Reservation #RES-${String(resId).padStart(4, "0")} verified. Customer details masked for POS privacy.`);
  };

  const handleOpenVerifyModal = (res: Reservation) => {
    setVerifyingRes(res);
    const initialTblId = res.table_id || tableOverviews[0]?.table_id || RESTAURANT_TABLES[0]?.id || 1;
    setVerifySelectedTableId(Number(initialTblId));
  };

  const handleConfirmVerifyAndAllot = async () => {
    if (!verifyingRes) return;
    setIsVerifyingAndAllotting(true);
    try {
      const targetTableId = verifySelectedTableId || verifyingRes.table_id || tableOverviews[0]?.table_id || RESTAURANT_TABLES[0]?.id || 1;
      const apiBase = getApiBase();
      const floorInfo = getTableFloor(targetTableId);
      const floorTableNum = floorInfo.floor_table_num;

      // 1. Assign/Allot Table via API
      const res = await posFetch(`${apiBase}/api/v1/reservations/${verifyingRes.id}/assign-table`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({
          table_id: targetTableId,
          table_name: `Table ${floorTableNum}`,
          floor_number: floorInfo.floor,
        }),
      });

      if (res.ok) {
        // 2. Mark verified (masks PII in POS)
        setVerifiedResIds((prev) => ({ ...prev, [verifyingRes.id]: true }));
        setLastNotification(`Reservation #RES-${String(verifyingRes.id).padStart(4, "0")} verified & Table ${floorTableNum} (${floorInfo.short}) allotted.`);
        setVerifyingRes(null);
        await Promise.all([fetchReservations(), fetchData()]);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Cannot allot table: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error during verification and table allotment.");
    } finally {
      setIsVerifyingAndAllotting(false);
    }
  };

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasWsEverConnectedRef = useRef<boolean>(false);

  const getApiBase = () => {
    return "";
  };

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

  // AudioContext unlock
  useEffect(() => {
    const unlockAudio = () => {
      try {
        if (!audioContextRef.current) {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
          }
        }
        if (audioContextRef.current && audioContextRef.current.state === "suspended") {
          audioContextRef.current.resume();
        }
      } catch { }
    };

    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.4, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1318.51, now + 0.1);
      gain2.gain.setValueAtTime(0.45, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.6);
    } catch { }
  };

  // Auth Verification
  const verifyToken = async (tok: string): Promise<boolean> => {
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const u = await res.json();
        setStaffUser(u);
        try {
          localStorage.setItem("jaadoo_pos_user", JSON.stringify(u));
        } catch { }
        return true;
      } else if (res.status === 401) {
        handleLogout();
        return false;
      } else {
        // Server sleeping / 502 / 503 / 504: retain session so POS does not kick cashier out
        return true;
      }
    } catch {
      // Network hiccup / offline: keep active session in POS
      return true;
    } finally {
      setIsAuthChecking(false);
    }
  };

  useEffect(() => {
    const savedToken = posSession.getValidToken();
    const savedUser = localStorage.getItem("jaadoo_pos_user");
    if (savedToken) {
      setPosToken(savedToken);
      if (savedUser) {
        try {
          setStaffUser(JSON.parse(savedUser));
        } catch { }
      }
      setIsAuthChecking(false);
      verifyToken(savedToken);
    } else {
      posSession.clearSession();
      setPosToken(null);
      setStaffUser(null);
      setIsAuthChecking(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoginError(err.detail || "Invalid credentials. Please verify username and password.");
        setIsLoggingIn(false);
        return;
      }
      const data = await res.json();
      const tok = data.access_token;
      posSession.setTokens(tok, data.refresh_token);
      if (data.user) {
        try {
          localStorage.setItem("jaadoo_pos_user", JSON.stringify(data.user));
        } catch { }
        setStaffUser(data.user);
      }
      setPosToken(tok);
      setIsLoggingIn(false);
    } catch {
      setLoginError("Network connection error. Café backend is unreachable.");
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    posSession.clearSession();
    setPosToken(null);
    setStaffUser(null);
    setLoginPassword("");
  };

  // Keep React state in sync with posFetch: renewed token, or session that could not be renewed
  useEffect(() => {
    const onRefreshed = (e: Event) => setPosToken((e as CustomEvent<string>).detail);
    const onExpired = () => {
      posSession.clearSession();
      setPosToken(null);
      setStaffUser(null);
      setLoginPassword("");
      setLoginError("Your session expired after 5 hours. Please log in again.");
    };
    window.addEventListener(POS_TOKEN_REFRESHED, onRefreshed);
    window.addEventListener(POS_SESSION_EXPIRED, onExpired);
    return () => {
      window.removeEventListener(POS_TOKEN_REFRESHED, onRefreshed);
      window.removeEventListener(POS_SESSION_EXPIRED, onExpired);
    };
  }, []);

  const getLocalDateString = (offsetDays = 0) => {
    const d = new Date();
    if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = getLocalDateString(0);
  const selectedDate = todayStr;
  const isTodaySelected = true;
  const isFutureDateSelected = false;

  const fetchData = async (overrideToken?: string, dateStr?: string) => {
    const tok = overrideToken || posToken;
    if (!tok) return;
    setIsRefreshing(true);
    const target = dateStr || selectedDate;
    const apiBase = getApiBase();
    try {
      const headers = { Authorization: `Bearer ${tok}` };
      const dateParam = target ? `?target_date=${target}` : "";
      setIsLoadingDoughCapacity(true);
      const [kotsRes, sumRes, tablesRes, doughRes] = await Promise.all([
        posFetch(`${apiBase}/api/v1/pos/kots${dateParam}`, { headers }),
        posFetch(`${apiBase}/api/v1/pos/summary${dateParam}`, { headers }),
        posFetch(`${apiBase}/api/v1/pos/table-sessions${dateParam}`, { headers }),
        posFetch(`${apiBase}/api/v1/pos/daily-dough-capacity${target ? `?target_date=${target}` : ""}`, { headers }),
      ]);

      if (kotsRes.status === 401 || kotsRes.status === 403) {
        handleLogout();
        return;
      }

      if (kotsRes.ok) {
        const kotsData = await kotsRes.json();
        setKots(kotsData);
      }
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary(sumData);
      }
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setTableOverviews(Array.isArray(tablesData) && tablesData.length > 0 ? tablesData : RESTAURANT_TABLES.map((table) => ({
          table_id: table.id,
          table_number: table.table_number,
          capacity: table.capacity,
          status: "Available",
          active_session_count: 0,
          total_sessions_today: 0,
          sessions: [],
          floor_number: table.floor,
          floor_name: getFloorName(table.floor),
          floor_table_num: table.floor_table_num,
        })));
      } else {
        setTableOverviews(RESTAURANT_TABLES.map((table) => ({
          table_id: table.id,
          table_number: table.table_number,
          capacity: table.capacity,
          status: "Available",
          active_session_count: 0,
          total_sessions_today: 0,
          sessions: [],
          floor_number: table.floor,
          floor_name: getFloorName(table.floor),
          floor_table_num: table.floor_table_num,
        })));
      }
      if (doughRes.ok) {
        const doughData = await doughRes.json();
        setDoughCapacity(doughData);
      }
    } catch (err) {
      console.error("POS Data fetch error:", err);
    } finally {
      setIsLoadingDoughCapacity(false);
      setIsRefreshing(false);
    }
  };

  const fetchReservations = async (overrideToken?: string, dateStr?: string) => {
    const tok = overrideToken || posToken;
    if (!tok) return;
    setIsRefreshingRes(true);
    const apiBase = getApiBase();
    try {
      // Fetch all reservations for branch 1 so POS always has full active reservation data
      const res = await posFetch(`${apiBase}/api/v1/reservations?branch_id=1`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReservations(data);
      }
    } catch (err) {
      console.error("Reservations fetch error:", err);
    } finally {
      setIsRefreshingRes(false);
    }
  };

  const fetchPendingReviews = async (overrideToken?: string) => {
    const tok = overrideToken || posToken;
    if (!tok) return;
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/reservations/pending-reviews`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingReviews(data);
      }
    } catch (err) {
      console.error("Pending reviews fetch error:", err);
    }
  };

  const handleUpdateReservationStatus = async (id: number, newStatus: string) => {
    if (!posToken) return;
    setUpdatingResId(id);
    const previousReservations = reservations;
    setReservations((prev) => prev.map((reservation) => reservation.id === id ? { ...reservation, status: newStatus } : reservation));
    const apiBase = getApiBase();
    try {
      if (newStatus === "SEATED") {
        const resObj = reservations.find((r) => r.id === id);
        if (resObj && resObj.table_id) {
          const checkinRes = await posFetch(`${apiBase}/api/v1/reservations/${id}/checkin`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${posToken}`,
            },
            body: JSON.stringify({ table_id: resObj.table_id }),
          });
          if (checkinRes.ok) {
            await Promise.all([fetchReservations(), fetchData(), fetchPendingReviews()]);
            return;
          }
        }
      }

      const res = await posFetch(`${apiBase}/api/v1/reservations/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await Promise.all([fetchReservations(), fetchData(), fetchPendingReviews()]);
      } else {
        const err = await res.json().catch(() => ({}));
        setReservations(previousReservations);
        toast.error(`Cannot update reservation: ${err.detail || "Server error"}`);
      }
    } catch {
      setReservations(previousReservations);
      toast.error("Network error updating reservation status.");
    } finally {
      setUpdatingResId(null);
    }
  };

  const handleReviewAction = async (creditId: number, utr: string, action: "VERIFY" | "REJECT") => {
    if (!posToken) return;
    const apiBase = getApiBase();
    try {
      if (action === "VERIFY") {
        const match = reservations.find(
          (r) =>
            (r.payment_reference && r.payment_reference.toLowerCase() === utr.toLowerCase()) ||
            r.status === "HOLD" ||
            r.status === "PAYMENT_PENDING"
        );
        const resId = match ? match.id : prompt("Enter Reservation ID to confirm with this verified credit:");
        if (!resId) return;

        const res = await posFetch(`${apiBase}/api/v1/reservations/${resId}/staff-verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${posToken}`,
          },
          body: JSON.stringify({ upi_utr: utr }),
        });
        if (res.ok) {
          toast.success(`Payment for Reservation #${resId} verified and confirmed!`);
          await Promise.all([fetchReservations(), fetchPendingReviews(), fetchData()]);
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(`Cannot verify payment: ${err.detail || "Server error"}`);
        }
      } else {
        if (!confirm(`Reject bank credit UTR: ${utr}? Staff review will flag this as reviewed.`)) return;
        setPendingReviews((prev) => prev.filter((p) => p.credit_id !== creditId));
      }
    } catch {
      toast.error("Network error processing review action.");
    }
  };

  const handleAssignTable = async (reservationId: number, tableId: number) => {
    if (!posToken) return;
    const apiBase = getApiBase();
    try {
      const targetTbl = tableOverviews.find((t) => t.table_id === tableId);
      const floorInfo = getTableFloor(tableId, targetTbl?.floor_number);
      const floorTableNum = targetTbl?.floor_table_num || floorInfo.floor_table_num;
      const res = await posFetch(`${apiBase}/api/v1/reservations/${reservationId}/assign-table`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({
          table_id: tableId,
          table_name: `Table ${floorTableNum}`,
          floor_number: floorInfo.floor,
        }),
      });
      if (res.ok) {
        setAssigningTableRes(null);
        await Promise.all([fetchReservations(), fetchData()]);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Cannot assign table: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error assigning table.");
    }
  };

  useEffect(() => {
    if (!posToken) return;
    fetchData(undefined, selectedDate);
    fetchReservations(undefined, selectedDate);
    fetchPendingReviews(undefined);
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchData(undefined, selectedDate);
      fetchReservations(undefined, selectedDate);
      fetchPendingReviews(undefined);
    }, 55000); // 55 seconds refresh interval
    return () => clearInterval(interval);
  }, [posToken, selectedDate]);

  useEffect(() => {
    if (!posToken) return;
    const wsBase = getWsBase();
    if (!wsBase) return;
    const connectWs = () => {
      try {
        if (wsRef.current) {
          try {
            wsRef.current.close();
          } catch { }
        }
        const ws = new WebSocket(`${wsBase}/ws/pos`);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          if (hasWsEverConnectedRef.current) {
            fetchData();
            fetchReservations();
            fetchPendingReviews();
          } else {
            hasWsEverConnectedRef.current = true;
          }
        };
        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeoutRef.current = setTimeout(connectWs, 4000);
        };
        ws.onerror = () => {
          setIsConnected(false);
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event === "KOT_CREATED" && autoPrintRef.current && data.kot_id) {
              enqueueKotPrintRef.current(Number(data.kot_id));
            }
            if (data.event === "KOT_UPDATED") {
              fetchData(); // print status changed: refresh quietly, no "new KOT" alert
            } else if (data.event === "KOT_CREATED") {
              const tableFl = getTableFloor(data.table_id || data.table_number);
              setLastNotification(`New KOT ${data.kot_number} received for Table ${tableFl.floor_table_num} (${tableFl.name})`);
              playChime();
              setTimeout(() => setLastNotification(null), 5000);
              fetchData();
            } else if (data.event === "SESSION_CLOSED") {
              const tableFl = getTableFloor(data.table_id || data.table_number);
              setLastNotification(`Table ${tableFl.floor_table_num} (${tableFl.name}) settled.`);
              setTimeout(() => setLastNotification(null), 5000);
              fetchData();
              fetchReservations();
            } else if (data.event === "RESERVATION_CREATED" || data.event === "RESERVATION_UPDATED") {
              setLastNotification(`Table Reservation #${data.id} confirmed (${data.guest_count} guests)`);
              playChime();
              setTimeout(() => setLastNotification(null), 5000);
              fetchData();
              fetchReservations();
            }
          } catch { }
        };
      } catch {
        setIsConnected(false);
      }
    };

    connectWs();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch { }
      }
    };
  }, [posToken, soundEnabled]);

  // Claim the KOT (so only one device prints it), print it here, then report the result.
  // Resolves true when this device printed it.
  const printKotOnThisDevice = async (kotId: number, force = false, manualWindow: Window | null = null): Promise<boolean> => {
    if (!posToken || printingIdsRef.current.has(kotId)) {
      manualWindow?.close();
      return false;
    }
    printingIdsRef.current.add(kotId);
    const apiBase = getApiBase();
    try {
      const claim = await posFetch(`${apiBase}/api/v1/pos/kots/${kotId}/claim-print${force ? "?force=true" : ""}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${posToken}` },
      });
      if (!claim.ok) {
        manualWindow?.close();
        return false; // 409: another device already printed / is printing it
      }
      const ticket: KotTicket = await claim.json();
      let success = true;
      try {
        if (serialPortRef.current) {
          manualWindow?.close();
          await writeToSerialPrinter(kotTicketForPrinter(ticket, kotPaperMm));
        } else {
          await printHtml(kotTicketHtml(ticket, kotPaperMm), manualWindow);
        }
      } catch {
        success = false;
      }
      await posFetch(`${apiBase}/api/v1/pos/kots/${kotId}/printed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${posToken}` },
        body: JSON.stringify({ success }),
      });
      return success;
    } catch (err) {
      manualWindow?.close();
      console.error("KOT print failed:", err);
      return false;
    } finally {
      printingIdsRef.current.delete(kotId);
    }
  };

  // Print one KOT at a time, in arrival order, with a 14-second gap after each printed KOT
  const enqueueKotPrint = (kotId: number, force = false) => {
    printQueueRef.current = printQueueRef.current
      .then(async () => {
        if (await printKotOnThisDevice(kotId, force)) await new Promise((r) => setTimeout(r, KOT_PRINT_GAP_MS));
      })
      .catch(() => {});
  };
  useEffect(() => {
    enqueueKotPrintRef.current = enqueueKotPrint;
  });

  // Catch-up: print recent KOTs this device missed (e.g. while the screen was closed or offline)
  useEffect(() => {
    if (!autoPrintKots) return;
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    kots
      .filter((k) => k.printed_status === "PENDING" && parseServerTime(k.created_at).getTime() >= cutoff)
      .sort((a, b) => a.id - b.id)
      .forEach((k) => enqueueKotPrint(k.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kots, autoPrintKots]);

  // Manual Print / Reprint: open the print window right on the tap (browsers block it later),
  // then show the ticket with the normal print dialog. Falls back to the hidden frame if blocked.
  const handleRetryPrint = async (kotId: number) => {
    if (!posToken) return;
    const manualWindow = serialPortRef.current ? null : window.open("", "_blank", "width=420,height=640");
    manualWindow?.document.write("<p style=\"font-family:sans-serif;padding:16px\">Preparing KOT…</p>");
    setRetryingIds((prev) => ({ ...prev, [kotId]: true }));
    try {
      await printKotOnThisDevice(kotId, true, manualWindow);
      await fetchData();
    } finally {
      setRetryingIds((prev) => ({ ...prev, [kotId]: false }));
    }
  };

  const handlePrintThermalBill = (
    session: TableSession,
    tableNumber: string,
    floorName: string,
    paymentMode: string = "UPI"
  ) => {
    const receiptDate = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const receiptTime = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const subtotal = Number(session.subtotal || session.total_amount || 0);
    const discount = Number(session.discount_amount || 0);
    const tax = Number(session.tax_amount || ((subtotal - discount) * 0.05));
    const gross = Number(session.gross_amount || (subtotal - discount + tax));
    const depositCredit = Number(session.reservation_credit || session.reservation_deposit_paid || 0);
    const netDue = Number(session.net_amount_due ?? Math.max(0, gross - depositCredit));
    const guestId = session.reservation_id
      ? `RES-${String(session.reservation_id).padStart(4, "0")}`
      : `GUEST-${session.session_seq || session.session_id}`;

    // Printer connected directly (Connect printer): send the bill straight to it
    if (serialPortRef.current) {
      const bytes = billEscPos(
        {
          header: ["JAADOO Pizza Project", "32 Sitaphal ki gali, Udaipur", "GSTIN: 08AAACJ1234F1Z5"],
          info: [
            [`Table: ${tableNumber}`, floorName],
            [`Paid by: ${paymentMode}`, receiptDate],
            [`Time: ${receiptTime}`, `Staff: ${staffUser?.username || "Cashier"}`],
            [`Guest: ${guestId}`, ""],
          ],
          allergyInfo: session.allergy_info,
          items: (session.items || []).map((it) => ({
            name: it.name,
            quantity: Number(it.quantity),
            rate: Number(it.unit_price),
            amount: Number(it.subtotal),
            note: it.special_instructions,
          })),
          totals: [
            { label: "Subtotal", value: subtotal },
            ...(discount > 0
              ? [{ label: `Discount${session.discount_type === "PERCENT" ? ` (${Number(session.discount_value)}%)` : ""}`, value: -discount }]
              : []),
            { label: "GST (5%)", value: tax },
            { label: "Gross Total", value: gross, bold: true },
            ...(depositCredit > 0 ? [{ label: "Advance deposit", value: -depositCredit }] : []),
          ],
          netDue,
          footer: ["*** CUSTOMER INVOICE ***", "Thank you for dining with us!", "Please visit Jaadoo Pizza Project again."],
        },
        kotPaperMm
      );
      writeToSerialPrinter(bytes)
        .then(() => toast.success(`Bill printed for ${tableNumber}`))
        .catch(() => toast.error("Bill did not print. Check the printer is on, then press Connect printer again."));
      return;
    }

    const printWindow = window.open("", "_blank", "width=380,height=600");
    if (!printWindow) {
      toast.warning("Please allow popups in your browser to print thermal customer bills.");
      return;
    }

    const itemsHtml = (session.items || [])
      .map(
        (it) => `
        <tr>
          <td style="text-align: left; padding: 4px 0; font-family: monospace;">${it.name}</td>
          <td style="text-align: center; padding: 4px 0; font-family: monospace;">${it.quantity}</td>
          <td style="text-align: right; padding: 4px 0; font-family: monospace;">₹${Number(it.unit_price).toFixed(2)}</td>
          <td style="text-align: right; padding: 4px 0; font-family: monospace;">₹${Number(it.subtotal).toFixed(2)}</td>
        </tr>
        ${it.special_instructions ? `<tr><td colspan="4" style="font-size: 10px; color: #555; padding-bottom: 4px;">* ${it.special_instructions}</td></tr>` : ""}
      `
      )
      .join("");

    const receiptContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bill Receipt - ${tableNumber} (${paymentMode})</title>
        <style>
          /* Sized to the paper chosen in POS; centred on the printable area (48mm on 58mm paper, 72mm on 80mm) */
          @page { size: ${kotPaperMm}mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: ${kotPaperMm >= 80 ? 72 : 48}mm;
            margin: 0 auto;
            padding: 8px 0;
            color: #000;
            background: #fff;
            font-size: ${kotPaperMm >= 80 ? 12 : 10}px;
            line-height: 1.3;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .title { font-size: 16px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
          .subtitle { font-size: 11px; margin-bottom: 2px; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .double-divider { border-top: 2px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; margin: 4px 0; font-size: 11px; }
          th { border-bottom: 1px dashed #000; padding: 4px 0; font-weight: bold; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 11px; }
          .total-row { font-size: 14px; font-weight: bold; margin: 6px 0; }
          .footer { margin-top: 14px; text-align: center; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <div class="title">JAADOO Pizza Project</div>
          <div class="subtitle">32 Sitaphal ki gali, Udaipur</div>
          <div class="subtitle">GSTIN: 08AAACJ1234F1Z5</div>
        </div>

        <div class="divider"></div>

        <div class="row">
          <span>Table: <strong>${tableNumber}</strong></span>
          <span>Floor: ${floorName}</span>
        </div>
        <div class="row">
          <span>Payment Mode: <strong>${paymentMode}</strong></span>
          <span>Date: ${receiptDate}</span>
        </div>
        <div class="row">
          <span>Time: ${receiptTime}</span>
          <span>Staff: ${staffUser?.username || "Cashier"}</span>
        </div>
        ${session.reservation_id ? `<div class="row"><span>Guest ID: RES-${String(session.reservation_id).padStart(4, "0")}</span></div>` : `<div class="row"><span>Guest ID: GUEST-${session.session_seq || session.session_id}</span></div>`}
        ${session.allergy_info ? `<div class="row" style="margin: 4px 0; padding: 3px; border: 1px dashed #000; font-size: 11px;"><span>⚠️ Allergy/Dietary:</span><strong>${escapeHtml(session.allergy_info)}</strong></div>` : ""}

        <div class="divider"></div>

        <table>
          <thead>
            <tr>
              <th style="text-align: left;">Item</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Rate</th>
              <th style="text-align: right;">Amt</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="divider"></div>

        <div class="row">
          <span>Subtotal:</span>
          <span>₹${subtotal.toFixed(2)}</span>
        </div>
        ${discount > 0
        ? `
          <div class="row">
            <span>Discount${session.discount_type === "PERCENT" ? ` (${Number(session.discount_value)}%)` : ""}:</span>
            <span>-₹${discount.toFixed(2)}</span>
          </div>
        `
        : ""
      }
        <div class="row">
          <span>GST (5%):</span>
          <span>₹${tax.toFixed(2)}</span>
        </div>
        <div class="row bold">
          <span>Gross Total:</span>
          <span>₹${gross.toFixed(2)}</span>
        </div>

        ${depositCredit > 0
        ? `
          <div class="row" style="color: #000;">
            <span>Advance Deposit Credit:</span>
            <span>-₹${depositCredit.toFixed(2)}</span>
          </div>
        `
        : ""
      }

        <div class="double-divider"></div>

        <div class="row total-row">
          <span>NET AMOUNT DUE:</span>
          <span>₹${netDue.toFixed(2)}</span>
        </div>

        <div class="double-divider"></div>

        <div class="footer">
          <div>*** CUSTOMER INVOICE ***</div>
          <div style="margin-top: 4px;">Thank you for dining with us!</div>
          <div>Please visit Jaadoo Pizza Project again.</div>
        </div>

        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 750);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(receiptContent);
    printWindow.document.close();
  };

  const handleSeatWalkIn = async () => {
    if (!walkInTableId) {
      toast.warning("Please select an available table.");
      return;
    }
    if (!posToken) {
      toast.error("Staff session expired. Please sign in again.");
      return;
    }
    setIsSeatingWalkIn(true);
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/pos/walk-in/seat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({
          table_id: walkInTableId,
          customer_name: walkInGuestName.trim() || "Walk-in Guest",
          guest_count: walkInGuestCount || 2,
        }),
      });
      if (res.ok) {
        setIsWalkInModalOpen(false);
        setWalkInGuestName("");
        setWalkInTableId(null);
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Failed to seat walk-in: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach backend server.");
    } finally {
      setIsSeatingWalkIn(false);
    }
  };

  const handleMergeTables = async () => {
    if (!mergeSourceTableId || !mergeTargetTableId) {
      toast.warning("Please select both source and destination tables to merge.");
      return;
    }
    if (mergeSourceTableId === mergeTargetTableId) {
      toast.warning("Source and destination tables must be different.");
      return;
    }
    if (!posToken) {
      toast.error("Staff session expired. Please sign in again.");
      return;
    }
    setIsMerging(true);
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/pos/tables/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({
          source_table_id: mergeSourceTableId,
          target_table_id: mergeTargetTableId,
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.success(data.message || "Tables merged successfully.");
        setIsMergeModalOpen(false);
        setMergeSourceTableId(null);
        setMergeTargetTableId(null);
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Failed to merge tables: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach backend server.");
    } finally {
      setIsMerging(false);
    }
  };

  const handleSaveBillEdit = async () => {
    if (!billEditSession) return;
    if (!posToken) {
      toast.error("Staff session expired.");
      return;
    }
    setIsSavingBillEdit(true);
    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/pos/sessions/${billEditSession.session_id}/items`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({
          items: billEditItems,
        }),
      });
      if (res.ok) {
        setBillEditSession(null);
        await fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Failed to update bill items: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach backend server.");
    } finally {
      setIsSavingBillEdit(false);
    }
  };

  const handleSettleBill = async () => {
    if (!billSettleSession || !billSettleTableInfo) return;
    if (!posToken) {
      toast.error("Staff session expired.");
      return;
    }
    const sessionId = billSettleSession.session_id;
    const tableId = billSettleTableInfo.tableId;
    const tableNumber = billSettleTableInfo.tableNumber;
    setClosingSessionIds((prev) => ({ ...prev, [sessionId]: true }));
    const apiBase = getApiBase();
    try {
      let res = await posFetch(`${apiBase}/api/v1/pos/sessions/${sessionId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
        body: JSON.stringify({ payment_mode: settlePaymentMode }),
      });

      if (!res.ok && tableId) {
        res = await posFetch(`${apiBase}/api/v1/pos/tables/${tableId}/settle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${posToken}`,
          },
          body: JSON.stringify({ payment_mode: settlePaymentMode }),
        });
      }

      if (res.ok) {
        setBillSettleSession(null);
        await Promise.all([fetchData(), fetchReservations()]);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Cannot settle table: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach café backend server.");
    } finally {
      setClosingSessionIds((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const handleCloseSession = async (sessionId: number, tableNumber: string, tableId?: number) => {
    if (!posToken) {
      toast.error("Staff session expired. Please sign in again.");
      return;
    }
    const session = tableOverviews.flatMap((t) => t.sessions).find((s) => s.session_id === sessionId);
    if (session) {
      setBillSettleSession(session);
      setBillSettleTableInfo({
        tableNumber,
        floorName: "",
        tableId: tableId || 0,
      });
      return;
    }
    setClosingSessionIds((prev) => ({ ...prev, [sessionId]: true }));
    const apiBase = getApiBase();
    try {
      let res = await posFetch(`${apiBase}/api/v1/pos/sessions/${sessionId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
      });

      if (!res.ok && tableId) {
        res = await posFetch(`${apiBase}/api/v1/pos/tables/${tableId}/settle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${posToken}`,
          },
        });
      }

      if (res.ok) {
        await Promise.all([fetchData(), fetchReservations()]);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Cannot settle table: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach café backend server.");
    } finally {
      setClosingSessionIds((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  const generatePDFReport = () => {
    const reportDate = summary?.business_date || new Date().toISOString().split("T")[0];
    const printTime = new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>JAADOO POS Reset Report - ${reportDate}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #261C18; padding: 24px; background: #fff; line-height: 1.4; }
          .header { text-align: left; border-bottom: 2px solid #261C18; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
          .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
          .header p { margin: 4px 0 0 0; font-size: 11px; color: #666; }
          .badge { font-size: 11px; font-weight: 600; color: #555; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
          .card { background: #FAF8F5; border: 1px solid #E4DCD0; padding: 10px; border-radius: 6px; }
          .card .title { font-size: 9px; text-transform: uppercase; color: #777; font-weight: 600; letter-spacing: 0.5px; }
          .card .val { font-size: 16px; font-weight: 700; color: #261C18; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
          th { background: #261C18; color: #fff; text-align: left; padding: 6px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
          td { border-bottom: 1px solid #eee; padding: 6px 10px; }
          tr:nth-child(even) { background: #FAF9F7; }
          .section-title { font-size: 12px; font-weight: 700; margin-top: 20px; margin-bottom: 6px; text-transform: uppercase; border-left: 3px solid #B85B43; padding-left: 6px; }
          .footer { margin-top: 30px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>JAADOO PIZZA PROJECT • POS OPERATIONAL REPORT</h1>
            <p>32 Sitaphal ki gali, Ganesh Ghati, Udaipur • Session Reset Summary</p>
          </div>
          <div class="badge">Date: ${reportDate} | Generated: ${printTime}</div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="title">Total Revenue</div>
            <div class="val">₹${kots.reduce((sum, k) => sum + (Number(k.total_amount) || 0), 0).toLocaleString("en-IN")}</div>
          </div>
          <div class="card">
            <div class="title">Total KOTs</div>
            <div class="val">${summary?.total_kots || kots.length || 0}</div>
          </div>
          <div class="card">
            <div class="title">Tables Served</div>
            <div class="val">${summary?.tables_served || 0}</div>
          </div>
          <div class="card">
            <div class="title">Avg KOT Value</div>
            <div class="val">₹${summary?.avg_kot_value ? Math.round(summary.avg_kot_value) : 0}</div>
          </div>
        </div>

        <div class="section-title">Active Table Sessions Before Reset</div>
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Status</th>
              <th>Session ID</th>
              <th>Opened At</th>
              <th>Items</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
    `;

    let activeCount = 0;
    tableOverviews.forEach((tbl) => {
      const fl = getTableFloor(tbl.table_id, tbl.floor_number);
      const relativeNum = tbl.floor_table_num || fl.floor_table_num;
      tbl.sessions.forEach((s) => {
        if (s.is_active) {
          activeCount++;
          htmlContent += `
            <tr>
              <td><strong>Table #${relativeNum} (${fl.name})</strong></td>
              <td><span style="color: #2e7d32; font-weight: bold;">ACTIVE</span></td>
              <td>#${s.session_seq}</td>
              <td>${parseServerTime(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
              <td>${s.items_count} items</td>
              <td><strong>₹${Number(s.total_amount || 0).toLocaleString("en-IN")}</strong></td>
            </tr>
          `;
        }
      });
    });

    if (activeCount === 0) {
      htmlContent += `<tr><td colspan="6" style="text-align:center; color:#888; padding: 12px;">No active sessions found at the time of reset.</td></tr>`;
    }

    htmlContent += `
          </tbody>
        </table>

        <div class="section-title">Live KOT Tickets (${kots.length})</div>
        <table>
          <thead>
            <tr>
              <th>KOT #</th>
              <th>Table</th>
              <th>Status</th>
              <th>Time</th>
              <th>Items</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
    `;

    kots.forEach((kot) => {
      const kotFl = getTableFloor(kot.table_id || kot.table_number);
      htmlContent += `
        <tr>
          <td><strong>${kot.kot_number}</strong></td>
          <td>Table #${kotFl.floor_table_num} (${kotFl.name})</td>
          <td>${kot.status}</td>
          <td>${parseServerTime(kot.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${kot.items_count}</td>
          <td><strong>₹${Number(kot.total_amount || 0).toLocaleString("en-IN")}</strong></td>
        </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>

        <div class="footer">
          JAADOO Pizza Project • Operational POS System • ${reportDate}
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=850,height=1100");
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    }
  };

  const handleResetAllSessions = async () => {
    if (!posToken) {
      toast.error("Staff session expired. Please sign in again.");
      return;
    }
    if (!confirm("Are you sure you want to RESET ALL POS SESSIONS?\n\nA PDF summary report will be generated and printed automatically.")) {
      return;
    }

    setIsResettingAll(true);
    try {
      generatePDFReport();
    } catch (e) {
      console.error("PDF generation warning:", e);
    }

    const apiBase = getApiBase();
    try {
      const res = await posFetch(`${apiBase}/api/v1/pos/sessions/reset-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${posToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.success(data.message || "All active table sessions reset. Tables are now Available.");
        await Promise.all([fetchData(), fetchReservations()]);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Failed to reset sessions: ${err.detail || "Server error"}`);
      }
    } catch {
      toast.error("Network error: Could not reach café backend server.");
    } finally {
      setIsResettingAll(false);
    }
  };

  const toggleSession = (sessionId: number) => {
    setExpandedSessions((prev) => ({
      ...prev,
      [sessionId]: prev[sessionId] === undefined ? false : !prev[sessionId],
    }));
  };

  const isSessionExpanded = (session: TableSession) => {
    if (expandedSessions[session.session_id] !== undefined) {
      return expandedSessions[session.session_id];
    }
    return session.is_active && session.items_count > 0;
  };

  const filteredTables = tableOverviews.filter((tbl) => {
    const floorNumber = tbl.floor_number || getTableFloor(tbl.table_id).floor;
    if (floorFilter !== "all" && floorNumber !== floorFilter) return false;
    if (tableFilter === "active") return tbl.active_session_count > 0;
    if (tableFilter === "available") return tbl.active_session_count === 0;
    return true;
  });

  // Calculate Operational Summary Metrics from existing data
  const activeTablesCount = tableOverviews.filter((t) => t.active_session_count > 0).length;
  const openKotsCount = kots.filter((k) => k.status !== "COMPLETED").length;
  const totalSalesToday = kots.reduce((sum, k) => sum + (Number(k.total_amount) || 0), 0);

  // Unsettled Sessions > 21 mins rule
  const unsettledLongSessions: Array<{
    table: TableOverview;
    session: TableSession;
    minutesOpen: number;
  }> = [];

  tableOverviews.forEach((tbl) => {
    (tbl.sessions || []).forEach((sess) => {
      if (sess.is_active && !sess.is_settled && sess.opened_at) {
        const openTime = parseServerTime(sess.opened_at).getTime();
        const mins = Math.floor((Date.now() - openTime) / (1000 * 60));
        if (mins >= 21) {
          unsettledLongSessions.push({
            table: tbl,
            session: sess,
            minutesOpen: mins,
          });
        }
      }
    });
  });

  // Needs Attention Items from existing data
  const failedKots = kots.filter((k) => k.printed_status === "FAILED");
  const arrivedUnseatedRes = reservations.filter((r) => r.status.toUpperCase() === "ARRIVED");
  const needsAttentionCount = failedKots.length + pendingReviews.length + arrivedUnseatedRes.length + unsettledLongSessions.length;

  // 1. Initial Checking Screen
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#FBF9F5] flex flex-col items-center justify-center p-6 text-center text-[#261C18]">
        <div className="w-8 h-8 border-2 border-[#261C18] border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs uppercase tracking-widest font-semibold text-stone-600">
          Loading JAADOO POS...
        </p>
      </div>
    );
  }

  // 2. Staff Authentication Gate - WARM BEIGE ARTISANAL THEME
  if (!posToken) {
    return (
      <div className="min-h-screen bg-[#F7F3EB] flex items-center justify-center p-4 font-sans text-[#2A1E17] selection:bg-[#B85B43] selection:text-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-md bg-[#FFFDF9] border border-[#E4DCD0] rounded-3xl p-8 shadow-xl space-y-6"
        >
          {/* Brand Header with Official Matchbox Logo */}
          <div className="text-center space-y-3">
            <div className="w-44 h-24 sm:w-52 sm:h-28 mx-auto rounded-2xl overflow-hidden border-2 border-[#9E3E26]/40 shadow-lg bg-white">
              <img
                src="/jaadoo_logo.jpg"
                alt="Jaadoo Pizza Project"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="pt-3">
                <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-2xl" />
              </h1>
              <p className="text-[11px] uppercase tracking-[0.25em] text-[#B85B43] font-bold mt-0.5">POS Terminal</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#6B5A4E] block mb-1.5">
                Staff Username
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="e.g. Jaadoo"
                required
                className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl px-4 py-3 text-sm text-[#2A1E17] placeholder-[#A8988B] outline-none transition-all shadow-2xs font-sans"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#6B5A4E] block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl px-4 py-3 pr-11 text-sm text-[#2A1E17] placeholder-[#A8988B] outline-none transition-all shadow-2xs font-sans"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6D] hover:text-[#B85B43] transition-colors p-1 cursor-pointer"
                  tabIndex={-1}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-[#B85B43] hover:bg-[#A34B34] text-white font-bold py-3.5 px-4 rounded-xl text-xs uppercase tracking-[0.2em] transition-all shadow-md active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {isLoggingIn ? "AUTHENTICATING..." : "ENTER POS TERMINAL"}
            </button>
          </form>

          {/* Quick links footer */}
          <div className="pt-4 border-t border-[#E8DFC9] flex items-center justify-between text-xs text-[#7A6A5E]">
            <Link href="/admin" className="hover:text-[#B85B43] font-semibold transition-colors flex items-center gap-1">
              <span>Owner Portal</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/" className="hover:text-[#B85B43] font-semibold transition-colors">
              Public Website
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const filteredKots = kots
    .filter((kot) => {
      if (filter === "failed") return kot.printed_status === "FAILED";
      if (filter === "printed") return kot.printed_status === "PRINTED";
      if (filter === "pending") return kot.printed_status === "PENDING";
      return true;
    })
    .sort((a, b) => {
      if (sortOrder === "asc") return a.sequence_number - b.sequence_number;
      return b.sequence_number - a.sequence_number;
    });

  const filteredReservations = reservations.filter((r) => {
    if (resFilter !== "all" && r.status.toUpperCase() !== resFilter) return false;
    if (resDate && r.reservation_date !== resDate) return false;
    const q = resSearch.trim().toLowerCase();
    return (
      !q ||
      (r.customer?.name || "").toLowerCase().includes(q) ||
      (r.customer?.phone || "").toLowerCase().includes(q) ||
      (r.table_name || `table ${r.table_id || ""}`).toLowerCase().includes(q) ||
      String(r.id).includes(q) ||
      (r.booking_id || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#F8F5F0] text-[#261C18] font-sans antialiased">

      {/* 1. COMPACT OPERATIONAL HEADER */}
      <header className="sticky top-0 z-40 bg-[#FBF9F5] border-b border-[#E4DCD0] px-4 sm:px-6 py-2 shadow-2xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2.5">

          {/* Left: Live Indicator & Shift Status */}
          <div className="flex items-center gap-2 sm:gap-3 order-2 md:order-1 md:flex-1 justify-start min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-sans font-medium text-stone-700">
              <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-600" : "bg-rose-500"}`} />
              <span className="uppercase tracking-wider font-semibold text-emerald-800">
                LIVE SHIFT
              </span>
              <span className="text-stone-400 hidden sm:inline">•</span>
              <span className="hidden font-mono text-stone-600 sm:inline">{todayStr}</span>
            </div>

            {currentTime && (
              <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-mono text-stone-500">
                <Clock className="w-3 h-3 text-stone-400" />
                <span>{currentTime}</span>
              </span>
            )}

            {lastNotification && (
              <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[#261C18] text-[#FBF9F5] text-[11px] font-medium border border-stone-700">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate max-w-[180px]">{lastNotification}</span>
              </div>
            )}
          </div>

          {/* Center: Brand Logo & Jaadoo Pizza Project POS */}
          <div className="flex items-center justify-center order-1 md:order-2 shrink-0">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-14 h-9 sm:w-18 sm:h-11 rounded-xl overflow-hidden border-2 border-[#9E3E26]/40 shadow-xs bg-white shrink-0">
                <img
                  src="/jaadoo_logo.jpg"
                  alt="Jaadoo Logo"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
              <span className="flex items-baseline gap-1.5">
                <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-base sm:text-lg leading-tight" />
                <span className="font-serif italic font-normal text-sm text-[#B85B43]">POS</span>
              </span>
            </Link>
          </div>

          {/* Right: Navigation Tabs & Staff Controls */}
          <div className="flex items-center justify-end gap-2 order-3 md:flex-1 w-full md:w-auto flex-wrap sm:flex-nowrap">
            <div className="flex w-full items-center justify-between bg-[#ECE6DC] p-0.5 rounded-lg text-xs font-medium border border-[#E4DCD0] sm:w-auto">
              <button
                onClick={() => setActiveTab("tables")}
                className={`flex-1 whitespace-nowrap px-2 py-1 rounded-md transition-colors cursor-pointer sm:flex-none sm:px-3 ${activeTab === "tables"
                  ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                  : "text-stone-700 hover:text-[#261C18]"
                  }`}
              >
                Tables ({activeTablesCount}/{tableOverviews.length})
              </button>
              <button
                onClick={() => setActiveTab("kots")}
                className={`flex-1 whitespace-nowrap px-2 py-1 rounded-md transition-colors cursor-pointer sm:flex-none sm:px-3 ${activeTab === "kots"
                  ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                  : "text-stone-700 hover:text-[#261C18]"
                  }`}
              >
                KOTs ({kots.length})
              </button>
              <button
                onClick={() => setActiveTab("reservations")}
                className={`flex-1 whitespace-nowrap px-2 py-1 rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1 sm:flex-none sm:px-3 ${activeTab === "reservations"
                  ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                  : "text-stone-700 hover:text-[#261C18]"
                  }`}
              >
                <span>Bookings</span>
                <span className="text-[10px] opacity-80">({reservations.length})</span>
                {pendingReviews.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 ml-0.5" />
                )}
              </button>
            </div>

            {/* Staff User */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-stone-600 px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              <span className="font-semibold text-stone-800">{staffUser?.username || "Staff"}</span>
            </div>

            {/* Audio Toggle */}
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) setTimeout(playChime, 50);
              }}
              className={`p-1.5 rounded-md border text-xs cursor-pointer ${soundEnabled
                ? "bg-[#261C18] border-[#261C18] text-[#FBF9F5]"
                : "bg-white border-[#E4DCD0] text-stone-500"
                }`}
              title={soundEnabled ? "Audio chime ON" : "Audio chime OFF"}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>

            {/* KOT auto-print (this device) */}
            <button
              type="button"
              onClick={() => {
                const next = !autoPrintKots;
                setAutoPrintKots(next);
                try { localStorage.setItem("jaadoo_kot_autoprint", next ? "on" : "off"); } catch {}
              }}
              className={`p-1.5 rounded-md border text-xs cursor-pointer flex items-center gap-1 ${autoPrintKots
                ? "bg-emerald-700 border-emerald-700 text-white"
                : "bg-white border-[#E4DCD0] text-stone-500"
                }`}
              title={autoPrintKots ? "KOTs print automatically on this device" : "Auto-print KOTs on this device is OFF"}
              aria-pressed={autoPrintKots}
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline font-semibold">{autoPrintKots ? "Auto-print ON" : "Auto-print OFF"}</span>
            </button>
            {/* Thermal printer connected directly (Chrome / Edge) */}
            {serialPrinter !== "unsupported" && (
              <button
                type="button"
                onClick={() => (serialPrinter === "on" ? disconnectSerialPrinter() : connectSerialPrinter())}
                disabled={serialPrinter === "connecting"}
                className={`p-1.5 rounded-md border text-xs cursor-pointer flex items-center gap-1 ${serialPrinter === "on"
                  ? "bg-emerald-50 border-emerald-600 text-emerald-800"
                  : "bg-white border-[#E4DCD0] text-stone-500"
                  }`}
                title={serialPrinter === "on"
                  ? "KOTs print straight to the connected printer. Click to disconnect."
                  : "Connect a Bluetooth / USB thermal printer that has no computer driver"}
              >
                <span className={`w-2 h-2 rounded-full ${serialPrinter === "on" ? "bg-emerald-500" : serialPrinter === "connecting" ? "bg-amber-400 animate-pulse" : "bg-stone-300"}`} />
                <span className="hidden sm:inline font-semibold">
                  {serialPrinter === "on" ? "Printer connected" : serialPrinter === "connecting" ? "Connecting…" : "Connect printer"}
                </span>
              </button>
            )}
            {(autoPrintKots || serialPrinter === "on") && (
              <select
                value={kotPaperMm}
                onChange={(e) => {
                  const mm = e.target.value === "58" ? 58 : 80;
                  setKotPaperMm(mm);
                  try { localStorage.setItem("jaadoo_kot_paper", String(mm)); } catch {}
                }}
                aria-label="KOT paper width"
                className="p-1 rounded-md border border-[#E4DCD0] bg-white text-xs cursor-pointer"
              >
                <option value={80}>80mm</option>
                <option value={58}>58mm</option>
              </select>
            )}

            {/* Refresh */}
            <button
              onClick={() => {
                fetchData();
                fetchReservations();
                fetchPendingReviews();
              }}
              disabled={isRefreshing || isRefreshingRes}
              className="p-1.5 rounded-md bg-white hover:bg-stone-100 text-stone-700 border border-[#E4DCD0] text-xs cursor-pointer disabled:opacity-50"
              title="Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || isRefreshingRes ? "animate-spin" : ""}`} />
            </button>

            {/* Owner Portal Link */}
            <Link
              href="/admin"
              className="p-1.5 rounded-md bg-white hover:bg-amber-50 text-[#B85B43] border border-[#E4DCD0] text-xs cursor-pointer flex items-center gap-1"
              title="Switch to Owner Portal"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </Link>

            {/* Lock */}
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md bg-white hover:bg-red-50 text-red-700 border border-red-200 text-xs cursor-pointer"
              title="Lock Terminal"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* ================= TAB 1: ACTIVE TABLES (PRIMARY OPERATIONAL SECTION) ================= */}
        {takeOrder && posToken && (
          <TakeOrderModal
            tableId={takeOrder.tableId}
            tables={tableOverviews.map((t) => {
              const fl = getTableFloor(t.table_id, t.floor_number);
              return { id: t.table_id, label: `Table ${t.floor_table_num || fl.floor_table_num} · ${fl.name}` };
            })}
            token={posToken}
            onClose={() => setTakeOrder(null)}
            onPlaced={() => fetchData()}
          />
        )}

        {activeTab === "tables" && (
          <>
            {/* 2. SUMMARY METRICS */}
            <section className="space-y-3">

              {/* 4 Primary Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                {/* Metric 1: Active Tables */}
                <div className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs">
                  <div className="text-[11px] font-sans uppercase tracking-wider font-semibold text-stone-500 flex items-center justify-between">
                    <span>ACTIVE TABLES</span>
                    <Users className="w-3.5 h-3.5 text-stone-400" />
                  </div>
                  <div className="text-2xl font-bold font-sans text-[#261C18] mt-1.5 flex items-baseline gap-1.5">
                    <span>{activeTablesCount}</span>
                    <span className="text-xs font-normal text-stone-400 font-sans">/ {tableOverviews.length} total</span>
                  </div>
                </div>

                {/* Metric 2: Open KOTs */}
                <div className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs">
                  <div className="text-[11px] font-sans uppercase tracking-wider font-semibold text-stone-500 flex items-center justify-between">
                    <span>OPEN KOTS</span>
                    <Receipt className="w-3.5 h-3.5 text-stone-400" />
                  </div>
                  <div className="text-2xl font-bold font-sans text-[#261C18] mt-1.5 flex items-baseline gap-1.5">
                    <span>{openKotsCount}</span>
                    <span className="text-xs font-normal text-stone-400 font-sans">({kots.length} total)</span>
                  </div>
                </div>

                {/* Metric 3: Today's Sales */}
                <div className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs">
                  <div className="text-[11px] font-sans uppercase tracking-wider font-semibold text-stone-500 flex items-center justify-between">
                    <span>TODAY&apos;S SALES</span>
                    <TrendingUp className="w-3.5 h-3.5 text-[#4A5842]" />
                  </div>
                  <div className="text-2xl font-bold font-sans text-[#261C18] mt-1.5">
                    ₹{totalSalesToday.toLocaleString("en-IN")}
                  </div>
                </div>

                {/* Metric 4: Needs Attention (Clickable to toggle action items) */}
                <div
                  onClick={() => {
                    if (needsAttentionCount > 0) {
                      setShowNeedsAttention((prev) => !prev);
                    }
                  }}
                  className={`p-4 rounded-lg border shadow-2xs transition-all select-none ${needsAttentionCount > 0
                      ? "bg-amber-50/80 border-amber-300 hover:border-amber-400 hover:bg-amber-100/50 cursor-pointer ring-1 ring-amber-300/60"
                      : "bg-white border-[#E4DCD0]"
                    }`}
                >
                  <div className="text-[11px] font-sans uppercase tracking-wider font-semibold flex items-center justify-between text-stone-500">
                    <span className={needsAttentionCount > 0 ? "text-amber-900 font-bold" : ""}>
                      NEEDS ATTENTION
                    </span>
                    <div className="flex items-center gap-1">
                      <AlertTriangle className={`w-3.5 h-3.5 ${needsAttentionCount > 0 ? "text-amber-600 animate-pulse" : "text-stone-400"}`} />
                      {needsAttentionCount > 0 && (
                        <ChevronDown className={`w-3.5 h-3.5 text-amber-800 transition-transform duration-200 ${showNeedsAttention ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </div>
                  <div className={`text-2xl font-bold font-sans mt-1.5 flex items-baseline justify-between ${needsAttentionCount > 0 ? "text-amber-800" : "text-stone-600"}`}>
                    <span>{needsAttentionCount}</span>
                    {needsAttentionCount > 0 && (
                      <span className="text-[10px] font-sans font-semibold text-amber-800 bg-amber-200/70 border border-amber-300 px-2 py-0.5 rounded-full">
                        {showNeedsAttention ? "Click to hide ▲" : "Click to view ▼"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* 4. NEEDS ATTENTION EXPANDABLE REVIEW SECTION (Toggled by Needs Attention Metric Card) */}
            {needsAttentionCount > 0 && showNeedsAttention && (
              <section className="bg-amber-50/80 border border-amber-300 p-4 rounded-lg space-y-3 transition-all animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                  <div className="flex items-center gap-2 text-amber-900 font-sans font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <span>OPERATIONAL ATTENTION REQUIRED ({needsAttentionCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-amber-800 uppercase">
                      Action Items
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNeedsAttention(false)}
                      className="text-amber-800 hover:text-amber-950 p-1 rounded-md hover:bg-amber-200/60 transition-colors cursor-pointer"
                      title="Hide review section"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {/* Failed Print KOTs */}
                  {failedKots.map((kot) => {
                    const kotFl = getTableFloor(kot.table_id || kot.table_number);
                    return (
                      <div key={kot.id} className="bg-white p-3 rounded-md border border-amber-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                        <div>
                          <span className="font-bold text-stone-900">{kot.kot_number}</span>
                          <span className="text-stone-500 ml-1.5">• Table {kotFl.floor_table_num} ({kotFl.short})</span>
                          <p className="text-[11px] text-red-700 font-medium mt-0.5">Thermal print job failed</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRetryPrint(kot.id)}
                          disabled={retryingIds[kot.id]}
                          className="px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-800 text-white font-semibold text-[11px] uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                        >
                          {retryingIds[kot.id] ? "Printing..." : "Retry Print"}
                        </button>
                      </div>
                    );
                  })}

                  {/* Pending Payment Reviews */}
                  {pendingReviews.map((rev) => (
                    <div key={rev.credit_id} className="bg-white p-3 rounded-md border border-amber-200 text-xs space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-stone-900">Bank Credit #{rev.credit_id}</span>
                        <span className="font-bold text-[#261C18]">₹{rev.amount}</span>
                      </div>
                      <p className="text-[11px] text-stone-600 font-mono truncate">UTR: {rev.utr}</p>
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => handleReviewAction(rev.credit_id, rev.utr, "VERIFY")}
                          className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewAction(rev.credit_id, rev.utr, "REJECT")}
                          className="px-2.5 py-1 border border-stone-200 hover:bg-red-50 text-red-700 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Arrived Unseated Guests */}
                  {arrivedUnseatedRes.map((res) => (
                    <div key={res.id} className="bg-white p-3 rounded-md border border-amber-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                      <div>
                        <span className="font-bold text-stone-900">#RES-{String(res.id).padStart(4, "0")}</span>
                        <span className="text-stone-500 ml-1.5">• {res.guest_count} Guests</span>
                        <p className="text-[11px] text-amber-800 font-medium mt-0.5">Arrived • Waiting for seating</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!res.table_id) setAssigningTableRes(res);
                          else handleUpdateReservationStatus(res.id, "SEATED");
                        }}
                        className="px-2.5 py-1 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] uppercase tracking-wider transition-colors cursor-pointer shrink-0"
                      >
                        {res.table_id ? "Seat" : "Assign"}
                      </button>
                    </div>
                  ))}

                  {/* 21+ Minute Unsettled Active Tables */}
                  {unsettledLongSessions.map(({ table, session, minutesOpen }) => {
                    const tblFloor = getTableFloor(table.table_id);
                    return (
                      <div key={`unsettled-${session.session_id}`} className="bg-white p-3 rounded-md border border-rose-300 text-xs flex items-center justify-between gap-2 shadow-2xs">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-rose-900">Table {tblFloor.floor_table_num} ({tblFloor.short})</span>
                            <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {minutesOpen} mins open
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-600 font-medium mt-0.5">
                            Session #{session.session_seq} unsettled (&gt;21 min limit) • ₹{Number(session.total_amount || 0).toFixed(0)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setBillSettleSession(session);
                            setBillSettleTableInfo({
                              tableNumber: String(tblFloor.floor_table_num),
                              floorName: tblFloor.name,
                              tableId: table.table_id,
                            });
                          }}
                          className="px-2.5 py-1.5 rounded-md bg-[#261C18] hover:bg-[#B85B43] text-white font-semibold text-[11px] uppercase tracking-wider transition-colors cursor-pointer shrink-0"
                        >
                          Review &amp; Settle
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. DAILY PIZZA CAPACITY (Restrained Operational Component) */}
            <section className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-[#B85B43]" />
                  <h3 className="text-xs font-sans font-bold uppercase tracking-wider text-[#261C18]">
                    DAILY PIZZA CAPACITY
                  </h3>
                  {isLoadingDoughCapacity ? (
                    <span className="text-[10px] text-stone-400 flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Loading...
                    </span>
                  ) : doughCapacity?.total_dough_limit == null ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-stone-100 text-stone-600 border border-stone-200">
                      NO RULE SET
                    </span>
                  ) : (doughCapacity.walk_in_available ?? 0) === 0 ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                      WALK-IN EXHAUSTED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      OPERATIONAL
                    </span>
                  )}
                </div>

                {doughCapacity?.total_dough_limit != null && (
                  <span className="text-xs font-sans text-stone-600">
                    <strong>{doughCapacity.total_allocated_dough}</strong> / {doughCapacity.total_dough_limit} used
                  </span>
                )}
              </div>

              {/* Progress Bar & Breakdown */}
              {doughCapacity?.total_dough_limit != null ? (
                <div className="space-y-2">
                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden flex">
                    <div
                      style={{
                        width: `${Math.min(100, ((doughCapacity.total_allocated_dough) / (doughCapacity.total_dough_limit || 1)) * 100)}%`,
                      }}
                      className="bg-amber-600 transition-all duration-300"
                      title="Allocated / Used"
                    />
                    <div
                      style={{
                        width: `${Math.min(100, ((doughCapacity.total_active_protected) / (doughCapacity.total_dough_limit || 1)) * 100)}%`,
                      }}
                      className="bg-blue-600 transition-all duration-300"
                      title="Protected for Reservations"
                    />
                  </div>

                  {/* Breakdown metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-sans pt-1">
                    {/* 1. Total Dough Limit */}
                    <div className="bg-[#FAF8F5] p-2 rounded-md border border-[#E4DCD0]/60">
                      <div className="text-[10px] text-stone-500 uppercase font-semibold">Total Dough Limit</div>
                      <div className="font-bold text-[#261C18] text-sm mt-0.5">
                        {doughCapacity.total_dough_limit}
                      </div>
                    </div>

                    {/* 2. Protected (Res.) */}
                    <div className="bg-[#FAF8F5] p-2 rounded-md border border-[#E4DCD0]/60">
                      <div className="text-[10px] text-blue-800 uppercase font-semibold">Protected (Res.)</div>
                      <div className="font-bold text-blue-900 text-sm mt-0.5">
                        {doughCapacity.total_active_protected}
                      </div>
                    </div>

                    {/* 3. Walk-In Available */}
                    <div className={`p-2 rounded-md border ${(doughCapacity.walk_in_available ?? 0) > 0
                      ? "bg-emerald-50/50 border-emerald-200 text-emerald-900"
                      : "bg-red-50/50 border-red-200 text-red-900"
                      }`}>
                      <div className="text-[10px] uppercase font-semibold opacity-80">Walk-In Available</div>
                      <div className="font-bold text-sm mt-0.5">
                        {doughCapacity.walk_in_available ?? 0}
                      </div>
                    </div>

                    {/* 4. Allocated Used */}
                    <div className="bg-[#FAF8F5] p-2 rounded-md border border-[#E4DCD0]/60">
                      <div className="text-[10px] text-stone-500 uppercase font-semibold">Allocated Used</div>
                      <div className="font-bold text-[#261C18] text-sm mt-0.5">
                        {doughCapacity.total_allocated_dough}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-stone-500 font-sans italic">
                  Standard kitchen dough limits apply.
                </p>
              )}
            </section>

            {/* RESERVATION VERIFICATION & PRIVACY SECTION (Between Capacity & Active Tables) */}
            <section className="bg-white border border-[#E4DCD0] p-4 rounded-lg space-y-3.5 shadow-2xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#E4DCD0] pb-2.5">
                <div className="flex items-center gap-2 text-[#261C18]">
                  <ShieldCheck className="w-4 h-4 text-[#B85B43]" />
                  <h3 className="font-serif font-bold text-sm tracking-tight">
                    Incoming Reservations Verification &amp; Privacy
                  </h3>
                  <span className="text-[10px] font-sans bg-[#FAF7F0] border border-[#E4DCD0] text-stone-600 px-2 py-0.5 rounded font-medium">
                    POS Privacy Guard
                  </span>
                </div>
                <span className="text-[11px] text-stone-500 font-sans">
                  Search bookings, verify guests &amp; allot physical tables • Full details in Admin CRM
                </span>
              </div>

              {/* Search Bar & Filter Controls */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 pt-0.5">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={resVerifySearch}
                    onChange={(e) => setResVerifySearch(e.target.value)}
                    placeholder="Search by #RES ID (e.g. 70), time slot, or table..."
                    className="w-full pl-8 pr-7 py-1.5 bg-[#FAF8F5] border border-[#E4DCD0] rounded-md text-xs font-sans text-[#261C18] placeholder:text-stone-400 focus:outline-hidden focus:border-[#B85B43] focus:bg-white transition-all"
                  />
                  {resVerifySearch && (
                    <button
                      type="button"
                      onClick={() => setResVerifySearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {(
                    [
                      { id: "all", label: "All Incoming" },
                      { id: "unverified", label: "Pending Verification" },
                      { id: "verified", label: "Verified" },
                    ] as const
                  ).map((tab) => {
                    const isActive = resVerifyFilter === tab.id;
                    const incomingAll = reservations.filter(
                      (r) => r.status.toUpperCase() === "CONFIRMED" || r.status.toUpperCase() === "ARRIVED"
                    );
                    const count =
                      tab.id === "all"
                        ? incomingAll.length
                        : tab.id === "unverified"
                          ? incomingAll.filter((r) => !verifiedResIds[r.id]).length
                          : incomingAll.filter((r) => Boolean(verifiedResIds[r.id])).length;

                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setResVerifyFilter(tab.id)}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${isActive
                            ? "bg-[#261C18] text-white shadow-2xs"
                            : "bg-[#FAF8F5] text-stone-600 hover:bg-[#F3EFEA] border border-[#E4DCD0]"
                          }`}
                      >
                        <span>{tab.label}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold ${isActive ? "bg-white/20 text-white" : "bg-stone-200 text-stone-700"
                            }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Filtered Reservation Results */}
              {(() => {
                const incoming = reservations.filter(
                  (r) => r.status.toUpperCase() === "CONFIRMED" || r.status.toUpperCase() === "ARRIVED"
                );
                const q = resVerifySearch.trim().toLowerCase();

                // When no search query is typed and not explicitly looking at verified tab, show search lookup prompt
                if (!q && resVerifyFilter !== "verified") {
                  return (
                    <div className="py-5 px-4 text-center border border-dashed border-[#E4DCD0] rounded-md bg-[#FAF8F5]/80 space-y-1">
                      <div className="flex items-center justify-center gap-1.5 text-stone-700 font-medium text-xs">
                        <Search className="w-3.5 h-3.5 text-[#B85B43]" />
                        <span>Search Booking ID to Verify &amp; Allot Table</span>
                      </div>
                      <p className="text-[11px] text-stone-500 font-sans">
                        Enter the guest&apos;s Reservation ID (e.g. <span className="font-mono font-bold text-[#261C18]">70</span> or <span className="font-mono font-bold text-[#261C18]">#RES-0070</span>) above to look up and approve their table.
                      </p>
                    </div>
                  );
                }

                const filtered = incoming.filter((res) => {
                  const isVerified = Boolean(verifiedResIds[res.id]);
                  if (resVerifyFilter === "unverified" && isVerified) return false;
                  if (resVerifyFilter === "verified" && !isVerified) return false;

                  if (!q) return true;
                  const idFormatted = `res-${String(res.id).padStart(4, "0")}`;
                  const idNum = String(res.id);
                  const timeSlot = (res.time_slot || "").toLowerCase();
                  const tableName = (res.table_name || "").toLowerCase();
                  const bookingId = (res.booking_id || "").toLowerCase();
                  const customerName = (res.customer?.name || "").toLowerCase();
                  const customerPhone = (res.customer?.phone || "").toLowerCase();

                  return (
                    idFormatted.includes(q) ||
                    idNum.includes(q) ||
                    bookingId.includes(q) ||
                    timeSlot.includes(q) ||
                    tableName.includes(q) ||
                    customerName.includes(q) ||
                    customerPhone.includes(q)
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="py-6 text-center border border-dashed border-[#E4DCD0] rounded-md bg-[#FAF8F5]">
                      <p className="text-xs text-stone-500 font-sans">
                        No reservations found matching &ldquo;{resVerifySearch}&rdquo;.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {filtered.map((res) => {
                      const isVerified = Boolean(verifiedResIds[res.id]);
                      const resFl = res.floor_number ? getFloorName(res.floor_number) : getTableFloor(res.table_id || 1).name;
                      return (
                        <div
                          key={res.id}
                          className={`p-3 rounded-md border text-xs flex items-center justify-between gap-2.5 transition-all ${isVerified
                              ? "bg-emerald-50/60 border-emerald-200 text-stone-800"
                              : "bg-[#FAF8F5] border-[#E4DCD0] text-[#261C18] hover:border-stone-400"
                            }`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[#261C18]">
                                #RES-{String(res.id).padStart(4, "0")}
                              </span>
                              <span className="text-stone-500 font-medium">
                                • {res.guest_count} Guests
                              </span>
                              {isVerified ? (
                                <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded border border-emerald-300">
                                  Verified
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded border border-amber-300">
                                  Pending
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-stone-600 truncate">
                              {isVerified ? (
                                <span>{res.time_slot} • Allotted: {res.table_name || `Table ${getTableFloor(res.table_id || 1).floor_table_num}`} ({resFl})</span>
                              ) : (
                                <span>{res.time_slot}</span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleOpenVerifyModal(res)}
                            className={`px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all shrink-0 cursor-pointer ${isVerified
                                ? "bg-emerald-700 hover:bg-emerald-800 text-white shadow-2xs"
                                : "bg-[#261C18] hover:bg-[#B85B43] text-white shadow-2xs"
                              }`}
                          >
                            {isVerified ? "✓ Allotted" : "Verify & Allot"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>

            {/* Table Operations Section */}
            <section className="space-y-4">

              {/* Table Controls Bar */}
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-[#E4DCD0]">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-serif font-bold text-[#261C18]">
                    Active Tables
                  </h2>
                  <span className="text-xs text-stone-500 font-sans">
                    ({tableOverviews.length} physical tables)
                  </span>

                  {/* Primary Quick Actions: Walk-in & Merge */}
                  <div className="flex items-center gap-1.5 ml-0 sm:ml-2">
                    <button
                      type="button"
                      onClick={() => {
                        const firstAvail = tableOverviews.find((t) => t.status === "Available");
                        setWalkInTableId(firstAvail ? firstAvail.table_id : (tableOverviews[0]?.table_id || 1));
                        setIsWalkInModalOpen(true);
                      }}
                      className="px-2.5 py-1.5 rounded-md bg-[#261C18] hover:bg-[#B85B43] text-white text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                    >
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                      <span>+ Walk-in Guest</span>
                    </button>

                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Reset All Action */}
                  <button
                    type="button"
                    onClick={handleResetAllSessions}
                    disabled={isResettingAll}
                    className="px-3 py-1.5 rounded-md bg-stone-100 hover:bg-rose-50 text-stone-700 hover:text-rose-700 border border-stone-200 font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    title="Generate session report and reset all table sessions"
                  >
                    <span className="flex items-center gap-1">
                      <RotateCw className={`w-3 h-3 ${isResettingAll ? "animate-spin" : ""}`} />
                      <span>{isResettingAll ? "Resetting..." : "Reset All Sessions"}</span>
                    </span>
                  </button>

                  {/* Floor Filter Tabs */}
                  <div className="flex flex-wrap items-center bg-[#F6F3EC] p-0.5 rounded-md border border-[#E4DCD0] text-xs">
                    <button
                      onClick={() => setFloorFilter("all")}
                      className={`px-2.5 py-1 rounded-sm font-medium transition-colors cursor-pointer ${floorFilter === "all"
                        ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                        : "text-stone-700 hover:text-[#261C18]"
                        }`}
                    >
                      All Floors
                    </button>
                    {RESTAURANT_FLOORS.map((fl) => (
                      <button
                        key={fl.id}
                        onClick={() => setFloorFilter(fl.id)}
                        className={`px-2.5 py-1 rounded-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${floorFilter === fl.id
                          ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                          : "text-stone-700 hover:text-[#261C18]"
                          }`}
                      >
                        <span>{fl.name}</span>
                        {fl.isComingSoon && (
                          <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.2 rounded font-normal">
                            Soon
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Take an order for any table */}
                  <button
                    type="button"
                    onClick={() => setTakeOrder({ tableId: null })}
                    className="px-3 py-1.5 rounded-md bg-[#B85B43] hover:bg-[#9E3E26] text-white font-bold text-xs tracking-wide flex items-center gap-1 cursor-pointer"
                  >
                    <UtensilsCrossed className="w-3.5 h-3.5" />
                    <span>New Order</span>
                  </button>

                  {/* Filter Selector */}
                  <div className="flex items-center bg-[#F6F3EC] p-0.5 rounded-md border border-[#E4DCD0]">
                    {(["all", "active", "available"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setTableFilter(mode)}
                        className={`px-2.5 py-1 rounded-sm capitalize font-medium transition-colors cursor-pointer ${tableFilter === mode
                          ? "bg-[#261C18] text-[#FBF9F5] font-semibold"
                          : "text-stone-700 hover:text-[#261C18]"
                          }`}
                      >
                        {mode === "all"
                          ? `All (${tableOverviews.length})`
                          : mode === "active"
                            ? `Occupied (${activeTablesCount})`
                            : `Available (${tableOverviews.length - activeTablesCount})`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tables Grid Layout */}
              {filteredTables.length === 0 ? (
                <div className="text-center py-12 px-4 bg-white rounded-lg border border-[#E4DCD0] space-y-2">
                  {floorFilter === 6 ? (
                    <>
                      <div className="inline-block p-3 bg-amber-50 rounded-full border border-amber-200 mb-1">
                        <Sparkles className="w-6 h-6 text-amber-700" />
                      </div>
                      <h4 className="text-sm font-bold text-[#261C18]">Floor 6: Everest Sky Deck</h4>
                      <p className="text-xs text-stone-500 max-w-sm mx-auto">
                        Exclusive rooftop sky deck with 360° views of Old City Udaipur & Lake Pichola is opening soon! Table capacity and seating arrangements will appear here once live.
                      </p>
                    </>
                  ) : (
                    <>
                      <UtensilsCrossed className="w-8 h-8 text-stone-300 mx-auto" />
                      <h4 className="text-sm font-semibold text-[#261C18]">No Tables Found</h4>
                      <p className="text-xs text-stone-500">
                        {tableFilter === "active"
                          ? "No tables currently have active dining sessions."
                          : "No tables match current filter."}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {(floorFilter === "all"
                    ? RESTAURANT_FLOORS.filter((f) => !f.isComingSoon)
                    : RESTAURANT_FLOORS.filter((f) => f.id === floorFilter)
                  ).map((floor) => {
                    const floorTables = filteredTables.filter(
                      (tbl) => (tbl.floor_number || getTableFloor(tbl.table_id).floor) === floor.id
                    );
                    if (floorTables.length === 0) return null;

                    return (
                      <div key={floor.id} className="space-y-3">
                        <div className="flex items-center justify-between bg-[#F8F5F0] px-4 py-2.5 rounded-lg border border-[#E4DCD0] shadow-2xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#B85B43]" />
                            <h3 className="font-serif font-bold text-sm text-[#261C18]">
                              Floor {floor.id}: {floor.name}
                            </h3>
                            <span className="text-xs text-stone-500 font-sans">
                              ({floorTables.length} {floorTables.length === 1 ? "Table" : "Tables"})
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {floorTables.map((tbl) => {
                            const floorInfo = getTableFloor(tbl.table_id, tbl.floor_number);
                            const floorTableNum = tbl.floor_table_num || floorInfo.floor_table_num;
                            const displayTableName = `TABLE ${String(floorTableNum).padStart(2, "0")}`;
                            const activeSessions = tbl.sessions.filter((s) => s.is_active);
                            const settledSessions = tbl.sessions.filter((s) => !s.is_active);
                            const showHistory = !!showClosedToday[tbl.table_id];
                            const visibleSessions = isTodaySelected
                              ? (showHistory ? tbl.sessions : activeSessions)
                              : tbl.sessions;

                            const isOccupied = tbl.active_session_count > 0;
                            const activeSession = activeSessions[0];

                            // Match any active booking for this table
                            const bookedReservation = reservations.find((r) => {
                              const matchId = r.table_id === tbl.table_id;
                              const matchName = r.table_name && (
                                (r.table_name.toLowerCase().replace(/\s+/g, "") === `table${floorTableNum}` ||
                                  r.table_name.toLowerCase().replace(/\s+/g, "") === `table${tbl.table_id}`) &&
                                (!r.floor_number || r.floor_number === floorInfo.floor)
                              );
                              const isActive = ["CONFIRMED", "ARRIVED", "SEATED", "HOLD", "PAYMENT_PENDING"].includes(r.status?.toUpperCase() || "");
                              const isDateMatch = !r.reservation_date || r.reservation_date === selectedDate;
                              return (matchId || matchName) && isActive && isDateMatch;
                            });

                            const isReserved = !!bookedReservation || tbl.status?.toUpperCase() === "RESERVED";

                            return (
                              <div
                                key={tbl.table_id}
                                className={`bg-white rounded-lg border transition-all overflow-hidden flex flex-col justify-between ${isOccupied
                                  ? "border-emerald-500 shadow-xs"
                                  : isReserved
                                    ? "border-amber-400 bg-amber-50/10 shadow-xs"
                                    : "border-[#E4DCD0]"
                                  }`}
                              >
                                {/* Card Top Header */}
                                <div className={`p-4 border-b ${isOccupied
                                  ? "bg-[#FAF7F2] border-emerald-200/70"
                                  : isReserved
                                    ? "bg-[#FAF0E1]/80 border-amber-200/70"
                                    : "bg-[#FAF8F5] border-[#E4DCD0]/60"
                                  }`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="flex items-baseline gap-2">
                                        <span className="font-mono font-bold text-xl text-[#261C18]">
                                          {displayTableName}
                                        </span>
                                        <span className="text-xs font-semibold text-[#B85B43]">
                                          • {floorInfo.name}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-stone-500 font-sans">
                                          {tbl.capacity || floorInfo.capacity} Seats
                                        </span>
                                        <span className="text-stone-300">•</span>
                                        {/* Clickable Session Button to show previous sessions of that table */}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setShowClosedToday((prev) => ({
                                              ...prev,
                                              [tbl.table_id]: !prev[tbl.table_id],
                                            }))
                                          }
                                          className={`text-[11px] font-sans font-semibold px-2 py-0.5 rounded-md border transition-colors cursor-pointer flex items-center gap-1 ${showHistory
                                            ? "bg-[#261C18] text-white border-[#261C18]"
                                            : settledSessions.length > 0
                                              ? "bg-[#FAF8F5] text-[#B85B43] border-[#E4DCD0] hover:bg-[#B85B43]/10"
                                              : "bg-stone-50 text-stone-500 border-stone-200"
                                            }`}
                                          title={
                                            settledSessions.length > 0
                                              ? "Click to toggle previous sessions of this table today"
                                              : "No past sessions yet today"
                                          }
                                        >
                                          <Clock className="w-3 h-3" />
                                          <span>
                                            {tbl.total_sessions_today} {tbl.total_sessions_today === 1 ? "Session" : "Sessions"}
                                            {settledSessions.length > 0 ? ` (${settledSessions.length} past)` : ""}
                                          </span>
                                          <ChevronDown className={`w-3 h-3 transition-transform ${showHistory ? "rotate-180" : ""}`} />
                                        </button>
                                      </div>
                                    </div>

                                    <div>
                                      {isOccupied ? (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                          OCCUPIED
                                        </span>
                                      ) : isReserved ? (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                                          <UserCheck className="w-3 h-3 text-amber-700" />
                                          RESERVED
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider bg-stone-100 text-stone-600 border border-stone-200">
                                          AVAILABLE
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Booked Reservation Banner */}
                                {bookedReservation && (
                                  <div className="mx-3 mt-3 p-2.5 bg-[#FAF0E1] border border-[#E8DFC9] rounded-md text-xs space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-[#9E3E26] flex items-center gap-1 uppercase tracking-wider text-[10px]">
                                        <UserCheck className="w-3.5 h-3.5 text-[#9E3E26]" />
                                        #RES-{String(bookedReservation.id).padStart(4, "0")}
                                      </span>
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${bookedReservation.status === "SEATED"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : bookedReservation.status === "ARRIVED"
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-blue-100 text-blue-800"
                                        }`}>
                                        {bookedReservation.status}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-stone-900 font-semibold text-xs">
                                      <span className="truncate">
                                        {verifiedResIds[bookedReservation.id] ? "Guest (Verified)" : "Reserved Guest"}
                                      </span>
                                      <span className="text-[11px] font-mono text-stone-600 shrink-0 ml-1">
                                        {bookedReservation.time_slot} ({bookedReservation.guest_count}p)
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Card Body: Session Info & Running Bill */}
                                <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                                  {/* 1. Active Session Details (if occupied) */}
                                  {isOccupied && activeSession ? (
                                    <div className="space-y-2.5">
                                      <div className="flex items-center justify-between text-xs font-sans">
                                        <span className="text-stone-500">
                                          Opened: <strong>{parseServerTime(activeSession.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
                                        </span>
                                        <span className="font-semibold text-stone-700">
                                          {activeSession.items_count} {activeSession.items_count === 1 ? "item" : "items"} ordered
                                        </span>
                                      </div>

                                      {activeSession.customer_name && (
                                        <div className="text-xs text-stone-700 font-medium">
                                          Guest: {activeSession.customer_name}
                                        </div>
                                      )}

                                      {/* Running Bill Total Box */}
                                      <div className="p-3 bg-[#FAF8F5] rounded-md border border-[#E4DCD0] flex items-center justify-between">
                                        <div>
                                          <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                                            Running Bill
                                          </span>
                                          <span className="text-xl font-bold font-sans text-[#261C18]">
                                            ₹{Number(activeSession.total_amount || 0).toLocaleString("en-IN")}
                                          </span>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => toggleSession(activeSession.session_id)}
                                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#B85B43] hover:underline cursor-pointer"
                                        >
                                          <span>{isSessionExpanded(activeSession) ? "Hide Details" : "View Items →"}</span>
                                        </button>
                                      </div>

                                      {/* Expandable Items List */}
                                      {isSessionExpanded(activeSession) && (
                                        <div className="pt-2 border-t border-stone-100 space-y-1.5">
                                          {activeSession.items.map((item, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-stone-100 last:border-none">
                                              <span className="text-stone-800">
                                                <strong className="text-[#261C18]">{item.quantity}×</strong> {item.name}
                                              </span>
                                              <span className="font-semibold text-stone-700">₹{item.subtotal}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ) : !showHistory ? (
                                    <div className="py-6 text-center text-xs text-stone-400 italic">
                                      Table is clean and ready for seating.
                                    </div>
                                  ) : null}

                                  {/* 2. Previous Settled Sessions of THIS table today (When Session Button is Clicked) */}
                                  {showHistory && (
                                    <div className="pt-2 space-y-2 border-t border-amber-200 bg-[#FAF8F5] p-3 rounded-md animate-in fade-in duration-150">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#B85B43] flex items-center gap-1.5">
                                          <Clock className="w-3.5 h-3.5" />
                                          <span>Previous Sessions Today ({settledSessions.length})</span>
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setShowClosedToday((prev) => ({
                                              ...prev,
                                              [tbl.table_id]: false,
                                            }))
                                          }
                                          className="text-[10px] text-stone-500 hover:text-stone-900 font-semibold underline cursor-pointer"
                                        >
                                          Close
                                        </button>
                                      </div>

                                      {settledSessions.length === 0 ? (
                                        <p className="text-xs text-stone-400 italic py-1">
                                          No previous settled sessions recorded for this table today.
                                        </p>
                                      ) : (
                                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                          {settledSessions.map((pastSess) => (
                                            <div
                                              key={pastSess.session_id}
                                              className="bg-white p-2.5 rounded-md border border-stone-200 text-xs space-y-1.5 shadow-2xs"
                                            >
                                              <div className="flex items-center justify-between font-sans">
                                                <span className="font-semibold text-stone-800">
                                                  Session #{pastSess.session_seq}
                                                </span>
                                                <span className="font-bold text-[#261C18]">
                                                  ₹{Number(pastSess.total_amount || 0).toLocaleString("en-IN")}
                                                </span>
                                              </div>

                                              <div className="text-[11px] text-stone-500 flex items-center justify-between">
                                                <span>
                                                  {parseServerTime(pastSess.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                  {pastSess.closed_at ? ` → ${parseServerTime(pastSess.closed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                                                </span>
                                                <span className="px-1.5 py-0.2 rounded-xs bg-stone-100 text-stone-600 text-[10px] font-medium">
                                                  Settled
                                                </span>
                                              </div>

                                              {pastSess.items && pastSess.items.length > 0 && (
                                                <div className="pt-1 border-t border-stone-100 text-[11px] space-y-0.5 text-stone-600">
                                                  {pastSess.items.map((item, idx) => (
                                                    <div key={idx} className="flex justify-between">
                                                      <span>{item.quantity}× {item.name}</span>
                                                      <span>₹{item.subtotal}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Bill Options for Occupied Table */}
                                  {isOccupied && activeSession && isTodaySelected && (
                                    <div className="pt-3 border-t border-stone-100 space-y-2 font-sans">
                                      {/* Primary Row: Print Bill ★ & Settle Bill */}
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPrintBillPaymentModal({
                                              session: activeSession,
                                              tableNumber: `Table ${floorTableNum}`,
                                              floorName: floorInfo.name,
                                            })
                                          }
                                          className="bg-[#B85B43] hover:bg-[#9E3E26] text-white py-2 px-2 rounded-md font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1 shadow-2xs cursor-pointer touch-manipulation select-none active:scale-[0.98] min-h-[38px]"
                                          title="Print formatted 80mm customer thermal invoice"
                                        >
                                          <Printer className="w-3.5 h-3.5" />
                                          <span>★ Print Bill</span>
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => {
                                            setBillSettleSession(activeSession);
                                            setBillSettleTableInfo({
                                              tableNumber: `Table ${floorTableNum}`,
                                              floorName: floorInfo.name,
                                              tableId: tbl.table_id,
                                            });
                                          }}
                                          disabled={closingSessionIds[activeSession.session_id]}
                                          className="bg-[#261C18] hover:bg-[#140E0A] text-white py-2 px-2 rounded-md font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50 touch-manipulation select-none active:scale-[0.98] min-h-[38px]"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                          <span>Settle Bill</span>
                                        </button>
                                      </div>

                                      {/* Add a new round: goes to the kitchen as a KOT */}
                                      <button
                                        type="button"
                                        onClick={() => setTakeOrder({ tableId: tbl.table_id })}
                                        className="w-full bg-[#B85B43] hover:bg-[#9E3E26] text-white py-1.5 rounded-md font-bold text-[11px] sm:text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                      >
                                        <UtensilsCrossed className="w-3.5 h-3.5" />
                                        <span>+ Add Order</span>
                                      </button>

                                      {/* Secondary Row: Preview Bill & Edit Bill */}
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setBillPreviewSession(activeSession);
                                            setBillPreviewTableInfo({
                                              tableNumber: `Table ${floorTableNum}`,
                                              floorName: floorInfo.name,
                                              tableId: tbl.table_id,
                                            });
                                          }}
                                          className="bg-[#F6F3EC] hover:bg-[#EAE4D6] text-[#261C18] border border-[#E4DCD0] py-1.5 px-2 rounded-md font-semibold text-[10px] sm:text-[11px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                        >
                                          <Eye className="w-3 h-3 text-stone-600" />
                                          <span>Preview</span>
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => {
                                            setBillEditSession(activeSession);
                                            setBillEditTableInfo({
                                              tableNumber: `Table ${floorTableNum}`,
                                              floorName: floorInfo.name,
                                              tableId: tbl.table_id,
                                            });
                                            setBillEditItems([...(activeSession.items || [])]);
                                          }}
                                          className="bg-[#F6F3EC] hover:bg-[#EAE4D6] text-[#261C18] border border-[#E4DCD0] py-1.5 px-2 rounded-md font-semibold text-[10px] sm:text-[11px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                        >
                                          <UtensilsCrossed className="w-3 h-3 text-stone-600" />
                                          <span>Edit Bill</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Available Table Quick Seat Walk-in */}
                                  {!isOccupied && !isReserved && isTodaySelected && (
                                    <div className="pt-2 border-t border-stone-100 grid grid-cols-2 gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setTakeOrder({ tableId: tbl.table_id })}
                                        className="w-full bg-[#B85B43] hover:bg-[#9E3E26] text-white py-1.5 rounded-md font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                      >
                                        <UtensilsCrossed className="w-3.5 h-3.5" />
                                        <span>Take Order</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setWalkInTableId(tbl.table_id);
                                          setIsWalkInModalOpen(true);
                                        }}
                                        className="w-full bg-[#FAF8F5] hover:bg-emerald-50 text-emerald-800 border border-emerald-300 py-1.5 rounded-md font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                      >
                                        <Users className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>+ Seat Walk-in</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* ================= TAB 2: LIVE KOT TICKETS ================= */}
        {activeTab === "kots" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

            {/* Left Column: Tickets Flow (7 Cols) */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-lg border border-[#E4DCD0]">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#261C18]">
                    LIVE KOT TICKETS ({filteredKots.length})
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {/* Sort */}
                  <div className="flex items-center bg-[#F6F3EC] p-0.5 rounded-md border border-[#E4DCD0]">
                    <button
                      onClick={() => setSortOrder("asc")}
                      className={`px-2 py-0.5 rounded-sm transition-colors cursor-pointer ${sortOrder === "asc" ? "bg-[#261C18] text-white font-semibold" : "text-stone-600"
                        }`}
                    >
                      1 → N
                    </button>
                    <button
                      onClick={() => setSortOrder("desc")}
                      className={`px-2 py-0.5 rounded-sm transition-colors cursor-pointer ${sortOrder === "desc" ? "bg-[#261C18] text-white font-semibold" : "text-stone-600"
                        }`}
                    >
                      Latest
                    </button>
                  </div>

                  {/* Filter */}
                  <div className="flex items-center bg-[#F6F3EC] p-0.5 rounded-md border border-[#E4DCD0]">
                    {(["all", "failed", "printed", "pending"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setFilter(t)}
                        className={`px-2.5 py-0.5 rounded-sm capitalize transition-colors cursor-pointer ${filter === t ? "bg-[#B85B43] text-white font-semibold" : "text-stone-600"
                          }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tickets List */}
              {filteredKots.length === 0 ? (
                <div className="text-center py-12 px-4 bg-white rounded-lg border border-[#E4DCD0] space-y-2">
                  <Printer className="w-8 h-8 text-stone-300 mx-auto" />
                  <h4 className="text-sm font-semibold text-[#261C18]">No Active Tickets</h4>
                  <p className="text-xs text-stone-500">
                    Incoming kitchen orders will appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredKots.map((kot) => {
                    const kotFl = getTableFloor(kot.table_id || kot.table_number);
                    return (
                      <div
                        key={kot.id}
                        className="bg-white rounded-lg border border-[#E4DCD0] p-4 shadow-2xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-2.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-[#261C18]">
                                {kot.kot_number}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 font-mono">
                                Table {kotFl.floor_table_num} • {kotFl.name}
                              </span>
                            </div>
                            <div className="text-[11px] text-stone-500 font-sans mt-0.5">
                              {parseServerTime(kot.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>

                          <div>
                            {kot.printed_status === "PRINTED" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                <Check className="w-3 h-3 text-emerald-600" /> Printed
                              </span>
                            ) : kot.printed_status === "FAILED" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                                <AlertCircle className="w-3 h-3 text-rose-600" /> Print Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                <RotateCw className="w-3 h-3 animate-spin text-amber-600" /> Pending
                              </span>
                            )}
                          </div>
                        </div>

                        {kot.allergy_info && (
                          <div className="p-2 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-1.5 font-sans">
                            <span className="font-bold shrink-0">⚠️ Allergy:</span>
                            <span className="font-semibold break-words">{kot.allergy_info}</span>
                          </div>
                        )}

                        {/* Items */}
                        <div className="divide-y divide-stone-100 text-xs font-sans">
                          {kot.items.map((item, idx) => (
                            <div key={idx} className="py-1.5 flex items-center justify-between">
                              <span className="text-[#261C18]">
                                <strong>{item.quantity}×</strong> {item.name}
                              </span>
                              <span className="font-semibold text-stone-700">₹{item.subtotal}</span>
                            </div>
                          ))}
                        </div>

                        {/* Footer */}
                        <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
                          <span className="text-stone-600 font-semibold">
                            Total: <strong className="text-[#261C18]">₹{Number(kot.total_amount || 0).toLocaleString("en-IN")}</strong>
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleRetryPrint(kot.id)}
                              disabled={retryingIds[kot.id]}
                              className={`px-2.5 py-1 rounded-md text-white text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1 ${kot.printed_status === "FAILED" ? "bg-rose-700 hover:bg-rose-800" : "bg-stone-600 hover:bg-stone-700"}`}
                            >
                              <Printer className="w-3 h-3" />
                              {retryingIds[kot.id]
                                ? "Printing..."
                                : kot.printed_status === "FAILED"
                                  ? "Retry Print"
                                  : kot.printed_status === "PRINTED"
                                    ? "Reprint"
                                    : "Print KOT"}
                            </button>

                            {kot.status !== "COMPLETED" && (
                              <button
                                onClick={() => handleCloseSession(kot.dining_session_id, `Table ${kotFl.floor_table_num} (${kotFl.name})`, kot.table_id)}
                                disabled={closingSessionIds[kot.dining_session_id]}
                                className="px-2.5 py-1 rounded-md bg-[#261C18] hover:bg-[#B85B43] text-white text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                              >
                                {closingSessionIds[kot.dining_session_id] ? "Settling..." : "Settle Table"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Volume Analytics (5 Cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#261C18] border-b border-stone-100 pb-2">
                  DISPATCH VOLUME SUMMARY
                </h4>
                <div className="space-y-2 text-xs">
                  {summary?.item_summary && summary.item_summary.length > 0 ? (
                    summary.item_summary.slice(0, 8).map((it, i) => (
                      <div key={i} className="flex items-center justify-between py-1 border-b border-stone-100 last:border-none">
                        <span className="text-stone-800 font-medium">{it.name}</span>
                        <span className="font-bold text-[#261C18]">{it.quantity} orders</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-stone-400 italic">No orders dispatched today.</p>
                  )}
                </div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-[#E4DCD0] shadow-2xs space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#261C18] border-b border-stone-100 pb-2">
                  TODAY vs YESTERDAY
                </h4>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1.5 px-2 bg-[#FAF8F5] rounded-md">
                    <span>KOTs</span>
                    <span className="font-bold">
                      {summary?.comparison?.today?.kots || 0} <span className="text-stone-400 font-normal">| {summary?.comparison?.yesterday?.kots || 0}</span>
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-[#FAF8F5] rounded-md">
                    <span>Pizzas</span>
                    <span className="font-bold">
                      {summary?.comparison?.today?.pizzas || 0} <span className="text-stone-400 font-normal">| {summary?.comparison?.yesterday?.pizzas || 0}</span>
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-[#FAF8F5] rounded-md">
                    <span>Pasta</span>
                    <span className="font-bold">
                      {summary?.comparison?.today?.pasta || 0} <span className="text-stone-400 font-normal">| {summary?.comparison?.yesterday?.pasta || 0}</span>
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 px-2 bg-[#FAF8F5] rounded-md">
                    <span>Beverages</span>
                    <span className="font-bold">
                      {summary?.comparison?.today?.beverages || 0} <span className="text-stone-400 font-normal">| {summary?.comparison?.yesterday?.beverages || 0}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: RESERVATIONS ================= */}
        {activeTab === "reservations" && (
          <section className="space-y-4">

            {/* Header & Filter */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-[#E4DCD0]">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#261C18]">
                GUEST RESERVATIONS ({filteredReservations.length})
              </h3>

              <input
                type="search"
                value={resSearch}
                onChange={(e) => setResSearch(e.target.value)}
                placeholder="Search guest, phone, table..."
                aria-label="Search reservations"
                className="w-full sm:w-56 px-3 py-1.5 rounded-md border border-[#E4DCD0] bg-[#F6F3EC] text-xs focus:outline-none focus:ring-1 focus:ring-[#261C18]"
              />

              <input
                type="date"
                value={resDate}
                onChange={(e) => setResDate(e.target.value)}
                aria-label="Filter reservations by date (clear for all dates)"
                title="Clear to show all dates"
                className="px-3 py-1.5 rounded-md border border-[#E4DCD0] bg-[#F6F3EC] text-xs focus:outline-none focus:ring-1 focus:ring-[#261C18]"
              />

              <div className="flex flex-wrap items-center gap-1 bg-[#F6F3EC] p-0.5 rounded-md border border-[#E4DCD0] text-xs">
                {(["all", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED"] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setResFilter(st)}
                    className={`px-2.5 py-1 rounded-sm capitalize transition-colors cursor-pointer ${resFilter === st
                      ? "bg-[#261C18] text-white font-semibold"
                      : "text-stone-600 hover:text-stone-900"
                      }`}
                  >
                    {st.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Reservations Grid */}
            {filteredReservations.length === 0 ? (
              <div className="text-center py-12 px-4 bg-white rounded-lg border border-[#E4DCD0] space-y-2">
                <Calendar className="w-8 h-8 text-stone-300 mx-auto" />
                <h4 className="text-sm font-semibold text-[#261C18]">No Reservations Found</h4>
                <p className="text-xs text-stone-500">No bookings exist in this view.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredReservations.map((res) => {
                  const cust = res.customer;
                  const isCurrentUpdating = updatingResId === res.id;
                  const st = res.status.toUpperCase();

                  const statusBadge =
                    st === "CONFIRMED"
                      ? "bg-blue-50 text-blue-800 border-blue-200"
                      : st === "ARRIVED"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : st === "SEATED"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : st === "COMPLETED"
                            ? "bg-stone-100 text-stone-700 border-stone-200"
                            : "bg-rose-50 text-rose-800 border-rose-200";

                  return (
                    <div
                      key={res.id}
                      className="bg-white rounded-lg border border-[#E4DCD0] p-4 shadow-2xs space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between border-b border-stone-100 pb-2">
                          <div>
                            <span className="font-mono font-bold text-sm text-[#261C18]">
                              {res.booking_id || formatBookingId(res.customer?.name, res.customer?.phone, res.id)}
                            </span>
                            <div className="text-[11px] text-stone-500 mt-0.5">
                              {res.reservation_date} • {res.time_slot}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${statusBadge}`}>
                            {res.status}
                          </span>
                        </div>

                        {/* Guest details - POS Privacy Protection (Admin retains full CRM records) */}
                        <div className="text-xs space-y-1.5 text-stone-700">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-[#261C18]">
                              {verifiedResIds[res.id] ? "Guest (Verified)" : "Guest"}
                            </span>
                            <span className="text-stone-500 font-semibold">{res.guest_count} Guests</span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-stone-400">
                            <span>ID: #RES-{String(res.id).padStart(4, "0")}</span>
                            {verifiedResIds[res.id] ? (
                              <span className="text-emerald-700 font-medium text-[10px] bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                ✓ Masked &amp; Verified
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleVerifyReservation(res.id)}
                                className="text-[#B85B43] hover:underline font-medium text-[10px] cursor-pointer"
                              >
                                Verify &amp; Mask
                              </button>
                            )}
                          </div>

                          {res.advance_amount !== undefined && Number(res.advance_amount) > 0 && (
                            <div className="text-[11px] text-emerald-800 bg-emerald-50 p-1.5 rounded-md border border-emerald-200 font-medium">
                              Deposit Paid: ₹{Number(res.advance_amount).toFixed(0)} ({res.payment_method || "UPI"})
                            </div>
                          )}

                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-stone-100">
                            <span className="text-stone-500">Floor:</span>
                            <span className="font-semibold text-[#B85B43]">
                              {res.floor_number ? getFloorName(res.floor_number) : getTableFloor(res.table_id || res.table_name || 1).name}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-stone-100">
                            <span className="text-stone-500">Table:</span>
                            {res.table_name || res.table_id ? (
                              <span className="font-bold text-[#261C18]">
                                {res.table_name || `Table ${res.table_id}`}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAssigningTableRes(res)}
                                className="text-[#B85B43] font-semibold hover:underline cursor-pointer"
                              >
                                + Assign Table
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Workflow state controls */}
                      <div className="pt-2 border-t border-stone-100 flex items-center gap-1.5">
                        {st === "CONFIRMED" && (
                          <>
                            <button
                              onClick={() => handleUpdateReservationStatus(res.id, "ARRIVED")}
                              disabled={isCurrentUpdating}
                              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              Arrived
                            </button>
                            <button
                              onClick={() => handleUpdateReservationStatus(res.id, "CANCELLED")}
                              disabled={isCurrentUpdating}
                              className="px-2.5 py-1.5 border border-red-200 text-red-700 hover:bg-red-50 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {st === "ARRIVED" && (
                          <button
                            onClick={() => {
                              if (!res.table_id) setAssigningTableRes(res);
                              else handleUpdateReservationStatus(res.id, "SEATED");
                            }}
                            disabled={isCurrentUpdating}
                            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {res.table_id ? "Seat Table" : "Assign & Seat"}
                          </button>
                        )}

                        {st === "SEATED" && (
                          <button
                            onClick={() => handleUpdateReservationStatus(res.id, "COMPLETED")}
                            disabled={isCurrentUpdating}
                            className="w-full bg-[#261C18] hover:bg-[#B85B43] text-white py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Complete
                          </button>
                        )}

                        {(st === "COMPLETED" || st === "CANCELLED") && (
                          <span className="w-full text-center text-xs text-stone-400 italic">
                            {st === "COMPLETED" ? "Completed" : "Cancelled"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Modal 1: Walk-in Guest Intake Portal */}
        {isWalkInModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-white rounded-xl w-full max-w-md p-5 border border-[#E4DCD0] shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-serif font-bold text-base text-[#261C18]">
                    Seat Walk-in Guest
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWalkInModalOpen(false)}
                  className="p-1 rounded-md hover:bg-stone-100 text-stone-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 font-sans text-xs">
                <div>
                  <label className="font-bold text-stone-700 uppercase tracking-wider block mb-1">
                    Select Table:
                  </label>
                  <select
                    value={walkInTableId || ""}
                    onChange={(e) => setWalkInTableId(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 bg-stone-50 font-sans focus:outline-hidden focus:border-[#B85B43]"
                  >
                    {tableOverviews.map((tbl) => {
                      const fl = getTableFloor(tbl.table_id, tbl.floor_number);
                      const relativeNum = tbl.floor_table_num || fl.floor_table_num;
                      return (
                        <option key={tbl.table_id} value={tbl.table_id}>
                          Table {relativeNum} ({fl.name} • {tbl.capacity || fl.capacity} Seats) — {tbl.status}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-stone-700 uppercase tracking-wider block mb-1">
                    Guest / Group Name (Optional):
                  </label>
                  <input
                    type="text"
                    value={walkInGuestName}
                    onChange={(e) => setWalkInGuestName(e.target.value)}
                    placeholder="e.g., Walk-in Guest"
                    className="w-full p-2.5 rounded-lg border border-stone-300 bg-white focus:outline-hidden focus:border-[#B85B43]"
                  />
                </div>

                <div>
                  <label className="font-bold text-stone-700 uppercase tracking-wider block mb-1">
                    Party Size (Guests):
                  </label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5, 6, 8].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setWalkInGuestCount(cnt)}
                        className={`flex-1 py-2 rounded-lg font-bold transition-colors cursor-pointer ${walkInGuestCount === cnt
                            ? "bg-[#261C18] text-white"
                            : "bg-[#F6F3EC] text-stone-700 hover:bg-[#EAE4D6]"
                          }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSeatWalkIn}
                  disabled={isSeatingWalkIn}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  {isSeatingWalkIn ? "Seating..." : "Seat Guest & Open Session"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsWalkInModalOpen(false)}
                  className="px-3.5 py-2.5 border border-stone-200 hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 2: Merge Tables Feature */}
        {isMergeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-white rounded-xl w-full max-w-md p-5 border border-[#E4DCD0] shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-700" />
                  <h3 className="font-serif font-bold text-base text-[#261C18]">
                    Merge Table Sessions
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="p-1 rounded-md hover:bg-stone-100 text-stone-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 bg-[#FAF8F5] border border-amber-200 rounded-lg text-xs space-y-1 text-stone-700">
                <p className="font-semibold text-amber-900">
                  Combine table orders & sessions:
                </p>
                <p>
                  All orders, items, and KOTs from the <strong>Source Table</strong> will be merged into the <strong>Target Table</strong>. The source table will be freed for new guests.
                </p>
              </div>

              <div className="space-y-3 font-sans text-xs">
                <div>
                  <label className="font-bold text-stone-700 uppercase tracking-wider block mb-1">
                    Source Table (To be merged from):
                  </label>
                  <select
                    value={mergeSourceTableId || ""}
                    onChange={(e) => setMergeSourceTableId(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 bg-stone-50 font-sans focus:outline-hidden focus:border-[#B85B43]"
                  >
                    {tableOverviews.map((tbl) => {
                      const fl = getTableFloor(tbl.table_id, tbl.floor_number);
                      const relativeNum = tbl.floor_table_num || fl.floor_table_num;
                      return (
                        <option key={tbl.table_id} value={tbl.table_id}>
                          Table {relativeNum} ({fl.name}) — {tbl.status}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-stone-700 uppercase tracking-wider block mb-1">
                    Target Table (Destination to combine into):
                  </label>
                  <select
                    value={mergeTargetTableId || ""}
                    onChange={(e) => setMergeTargetTableId(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-stone-300 bg-stone-50 font-sans focus:outline-hidden focus:border-[#B85B43]"
                  >
                    {tableOverviews.map((tbl) => {
                      const fl = getTableFloor(tbl.table_id, tbl.floor_number);
                      const relativeNum = tbl.floor_table_num || fl.floor_table_num;
                      return (
                        <option key={tbl.table_id} value={tbl.table_id}>
                          Table {relativeNum} ({fl.name}) — {tbl.status}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMergeTables}
                  disabled={isMerging}
                  className="flex-1 bg-[#B85B43] hover:bg-[#9E3E26] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  {isMerging ? "Merging..." : "Confirm Table Merge"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="px-3.5 py-2.5 border border-stone-200 hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 3: Preview Bill */}
        {billPreviewSession && billPreviewTableInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-white rounded-xl w-full max-w-md p-5 border border-[#E4DCD0] shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-[#B85B43]" />
                  <h3 className="font-serif font-bold text-base text-[#261C18]">
                    {billPreviewTableInfo.tableNumber} • Bill Preview
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setBillPreviewSession(null)}
                  className="p-1 rounded-md hover:bg-stone-100 text-stone-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 font-sans text-xs">
                <div className="flex justify-between text-stone-500 border-b border-stone-100 pb-2">
                  <span>Session: #{billPreviewSession.session_seq}</span>
                  <span>{parseServerTime(billPreviewSession.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                {billPreviewSession.allergy_info && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <span className="font-bold shrink-0">⚠️ Allergy/Dietary:</span>
                    <span className="font-medium break-words">{billPreviewSession.allergy_info}</span>
                  </div>
                )}

                {/* Items List */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {billPreviewSession.items && billPreviewSession.items.length > 0 ? (
                    billPreviewSession.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-start text-stone-800">
                        <span className="flex-1">
                          <strong>{it.quantity}×</strong> {it.name}
                        </span>
                        <span className="font-bold">₹{Number(it.subtotal).toFixed(2)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-stone-400 italic text-center py-3">No items placed yet in this session.</p>
                  )}
                </div>

                {/* Totals Breakdown */}
                <div className="bg-[#FAF8F5] p-3 rounded-lg border border-[#E4DCD0] space-y-1.5 pt-2 text-xs">
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal:</span>
                    <span>₹{Number(billPreviewSession.subtotal || billPreviewSession.total_amount || 0).toFixed(2)}</span>
                  </div>
                  {Number(billPreviewSession.discount_amount || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>
                        Discount{billPreviewSession.discount_type === "PERCENT" ? ` (${Number(billPreviewSession.discount_value)}%)` : ""}:
                      </span>
                      <span>-₹{Number(billPreviewSession.discount_amount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-stone-600">
                    <span>GST (5%):</span>
                    <span>₹{Number(billPreviewSession.tax_amount || ((billPreviewSession.subtotal || billPreviewSession.total_amount || 0) * 0.05)).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-stone-900 border-t border-stone-200 pt-1">
                    <span>Gross Amount:</span>
                    <span>₹{Number(billPreviewSession.gross_amount || billPreviewSession.total_amount || 0).toFixed(2)}</span>
                  </div>

                  {Number(billPreviewSession.reservation_credit || billPreviewSession.reservation_deposit_paid || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>Advance Deposit Credit:</span>
                      <span>-₹{Number(billPreviewSession.reservation_credit || billPreviewSession.reservation_deposit_paid || 0).toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm font-extrabold text-[#B85B43] border-t border-dashed border-stone-300 pt-2">
                    <span>NET AMOUNT DUE:</span>
                    <span>₹{Number(billPreviewSession.net_amount_due ?? billPreviewSession.gross_amount ?? billPreviewSession.total_amount).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPrintBillPaymentModal({
                      session: billPreviewSession,
                      tableNumber: billPreviewTableInfo.tableNumber,
                      floorName: billPreviewTableInfo.floorName,
                    });
                  }}
                  className="flex-1 bg-[#B85B43] hover:bg-[#9E3E26] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Printer className="w-4 h-4" />
                  <span>★ Print Bill</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const sess = billPreviewSession;
                    const info = billPreviewTableInfo;
                    setBillPreviewSession(null);
                    setBillSettleSession(sess);
                    setBillSettleTableInfo(info);
                  }}
                  className="flex-1 bg-[#261C18] hover:bg-[#140E0A] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Settle Bill</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 4: Edit Bill Items */}
        {billEditSession && billEditTableInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-white rounded-xl w-full max-w-md p-5 border border-[#E4DCD0] shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <UtensilsCrossed className="w-5 h-5 text-stone-800" />
                  <h3 className="font-serif font-bold text-base text-[#261C18]">
                    {billEditTableInfo.tableNumber} • Edit Bill Items
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setBillEditSession(null)}
                  className="p-1 rounded-md hover:bg-stone-100 text-stone-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 font-sans text-xs">
                <p className="text-stone-500">
                  Adjust item quantities or remove cancelled items before settlement.
                </p>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {billEditItems.length > 0 ? (
                    billEditItems.map((it, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg bg-[#FAF8F5] border border-stone-200 flex items-center justify-between gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-stone-900 truncate">{it.name}</p>
                          <p className="text-[11px] text-stone-500 font-mono">₹{it.unit_price} each</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center bg-white border border-stone-300 rounded-md">
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = [...billEditItems];
                                if (newItems[idx].quantity > 1) {
                                  newItems[idx].quantity -= 1;
                                  newItems[idx].subtotal = newItems[idx].quantity * newItems[idx].unit_price;
                                } else {
                                  newItems.splice(idx, 1);
                                }
                                setBillEditItems(newItems);
                              }}
                              className="px-2 py-1 hover:bg-stone-100 font-bold text-stone-700 cursor-pointer"
                            >
                              -
                            </button>
                            <span className="px-2 font-bold font-mono">{it.quantity}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = [...billEditItems];
                                newItems[idx].quantity += 1;
                                newItems[idx].subtotal = newItems[idx].quantity * newItems[idx].unit_price;
                                setBillEditItems(newItems);
                              }}
                              className="px-2 py-1 hover:bg-stone-100 font-bold text-stone-700 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          <span className="font-bold text-stone-900 w-16 text-right font-mono">
                            ₹{(it.quantity * it.unit_price).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-stone-400 italic text-center py-4">No items remaining in this bill.</p>
                  )}
                </div>

                <div className="flex justify-between items-center bg-stone-100 p-2.5 rounded-lg font-bold text-xs">
                  <span>Updated Subtotal:</span>
                  <span className="text-[#B85B43] text-sm">
                    ₹{billEditItems.reduce((acc, it) => acc + (it.quantity * it.unit_price), 0).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveBillEdit}
                  disabled={isSavingBillEdit}
                  className="flex-1 bg-[#261C18] hover:bg-[#B85B43] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  {isSavingBillEdit ? "Saving..." : "Save Bill Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setBillEditSession(null)}
                  className="px-3.5 py-2.5 border border-stone-200 hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 5: Settle Bill & Close Session */}
        {billSettleSession && billSettleTableInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-white rounded-xl w-full max-w-md p-5 border border-[#E4DCD0] shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-serif font-bold text-base text-[#261C18]">
                    Settle Table Bill & Free Table
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setBillSettleSession(null)}
                  className="p-1 rounded-md hover:bg-stone-100 text-stone-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 bg-[#FAF8F5] border border-stone-200 rounded-lg text-xs space-y-2 font-sans">
                <div className="flex justify-between font-bold text-stone-800">
                  <span>{billSettleTableInfo.tableNumber}</span>
                  <span>Session #{billSettleSession.session_seq}</span>
                </div>

                {billSettleSession.allergy_info && (
                  <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-1.5">
                    <span className="font-bold shrink-0">⚠️ Allergy:</span>
                    <span className="font-medium break-words">{billSettleSession.allergy_info}</span>
                  </div>
                )}

                <div className="border-t border-stone-200 pt-2 space-y-1 text-stone-600">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>₹{Number(billSettleSession.subtotal || billSettleSession.total_amount || 0).toFixed(2)}</span>
                  </div>
                  {Number(billSettleSession.discount_amount || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>
                        Discount{billSettleSession.discount_type === "PERCENT" ? ` (${Number(billSettleSession.discount_value)}%)` : ""}:
                      </span>
                      <span>-₹{Number(billSettleSession.discount_amount).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>GST (5%):</span>
                    <span>₹{Number(billSettleSession.tax_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Gross Amount:</span>
                    <span>₹{Number(billSettleSession.gross_amount || billSettleSession.total_amount || 0).toFixed(2)}</span>
                  </div>

                  {Number(billSettleSession.reservation_credit || billSettleSession.reservation_deposit_paid || 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>Advance Deposit Credit:</span>
                      <span>-₹{Number(billSettleSession.reservation_credit || billSettleSession.reservation_deposit_paid || 0).toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-base font-extrabold text-[#261C18] border-t border-stone-300 pt-1.5">
                    <span>Net Amount Due:</span>
                    <span className="text-emerald-800 font-mono">
                      ₹{Number(billSettleSession.net_amount_due ?? billSettleSession.gross_amount ?? billSettleSession.total_amount).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {posToken && (
                <SettleDiscountControl
                  key={billSettleSession.session_id}
                  session={billSettleSession}
                  token={posToken}
                  onApplied={(update) => {
                    setBillSettleSession((prev) => (prev ? { ...prev, ...update } : prev));
                    fetchData();
                  }}
                />
              )}

              {/* Payment Mode Selector */}
              <div className="space-y-1.5 font-sans text-xs">
                <label className="font-bold text-stone-700 uppercase tracking-wider block">
                  Received Payment Mode:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["CASH", "UPI", "CARD"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSettlePaymentMode(mode)}
                      className={`py-2 rounded-lg font-bold transition-colors cursor-pointer text-center ${settlePaymentMode === mode
                          ? "bg-[#261C18] text-white shadow-2xs"
                          : "bg-[#F6F3EC] text-stone-700 hover:bg-[#EAE4D6]"
                        }`}
                    >
                      {mode === "CASH" ? "💵 Cash" : mode === "UPI" ? "📱 UPI" : "💳 Card"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSettleBill}
                  disabled={closingSessionIds[billSettleSession.session_id]}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{closingSessionIds[billSettleSession.session_id] ? "Settling..." : "Confirm & Clear Table"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillSettleSession(null)}
                  className="px-3.5 py-2.5 border border-stone-200 hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: SELECT PAYMENT MODE FOR BILL PRINT */}
        {printBillPaymentModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 font-sans text-stone-900 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[#241A14]">Select Payment Mode</h3>
                  <p className="text-xs text-[#665448] mt-0.5 font-medium">
                    {printBillPaymentModal.tableNumber} ({printBillPaymentModal.floorName})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrintBillPaymentModal(null)}
                  className="text-[#8C7A6D] hover:text-[#241A14] p-1 rounded-lg text-lg cursor-pointer"
                  title="Cancel"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-[#7A6A5E] font-medium">
                Choose payment mode to print on the customer invoice:
              </p>

              <div className="grid grid-cols-1 gap-2.5 pt-1">
                {/* ponytail: DRY mapped payment mode selector with single-click thermal print */}
                {(
                  [
                    { mode: "UPI" as const, desc: "Google Pay / PhonePe / Paytm / QR", icon: Smartphone, bg: "bg-purple-100 text-purple-700 group-hover:bg-purple-200" },
                    { mode: "Cash" as const, desc: "Counter Cash Payment", icon: Banknote, bg: "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200" },
                    { mode: "Card" as const, desc: "Debit / Credit Card POS Swipe", icon: CreditCard, bg: "bg-blue-100 text-blue-700 group-hover:bg-blue-200" },
                  ] as const
                ).map(({ mode, desc, icon: Icon, bg }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      const target = printBillPaymentModal;
                      setPrintBillPaymentModal(null);
                      handlePrintThermalBill(target.session, target.tableNumber, target.floorName, mode);
                    }}
                    className="flex items-center gap-3.5 p-3.5 rounded-2xl border-2 border-[#E2D5C3] hover:border-[#9E3E26] bg-white hover:bg-[#FAF4EC] transition-all cursor-pointer shadow-2xs group text-left touch-manipulation select-none active:scale-[0.98]"
                  >
                    <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-sm text-[#241A14] group-hover:text-[#9E3E26]">{mode}</div>
                      <div className="text-[11px] text-[#7A6A5E]">{desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setPrintBillPaymentModal(null)}
                  className="w-full py-2.5 rounded-xl border border-[#D8CABE] text-[#665448] font-bold text-xs hover:bg-[#F0E8DC] transition-colors cursor-pointer touch-manipulation select-none active:scale-[0.98]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verification & Table Allotment Pop-up Modal */}
        {verifyingRes && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-xl shadow-2xl border border-[#E4DCD0] max-w-md w-full p-5 space-y-4 font-sans animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-[#E4DCD0] pb-3">
                <div className="flex items-center gap-2 text-[#261C18]">
                  <ShieldCheck className="w-5 h-5 text-[#B85B43]" />
                  <div>
                    <h3 className="font-serif font-bold text-base text-[#261C18]">
                      Verify &amp; Allot Table
                    </h3>
                    <p className="text-[11px] text-stone-500">
                      Confirm guest arrival, allot table, and apply POS privacy mask
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setVerifyingRes(null)}
                  className="text-stone-400 hover:text-stone-700 p-1 rounded-md transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Booking Summary Box */}
              <div className="bg-[#FAF8F5] border border-[#E4DCD0] rounded-lg p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-[#261C18] font-mono text-sm">
                    #RES-{String(verifyingRes.id).padStart(4, "0")}
                  </span>
                  <span className="bg-[#FAF7F0] border border-[#E4DCD0] text-stone-700 px-2 py-0.5 rounded font-semibold text-[11px]">
                    👥 {verifyingRes.guest_count} Guests
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-stone-600 pt-1 text-[11px]">
                  <div>
                    <span className="text-stone-400 block text-[10px] uppercase font-semibold">Date &amp; Slot</span>
                    <span className="font-medium text-[#261C18]">{verifyingRes.reservation_date || resDate} • {verifyingRes.time_slot}</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block text-[10px] uppercase font-semibold">Advance Deposit</span>
                    <span className="font-medium text-emerald-700">₹{verifyingRes.advance_amount ?? 0}</span>
                  </div>
                </div>

                <div className="border-t border-[#E4DCD0]/60 pt-2 text-[11px] text-stone-500">
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-[#B85B43] shrink-0" />
                    <span>Customer identity is masked in POS for staff privacy.</span>
                  </div>
                </div>
              </div>

              {/* Table Selection Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#261C18] uppercase tracking-wider block">
                  Select Physical Table to Allot:
                </label>
                <div className="relative">
                  <select
                    value={verifySelectedTableId}
                    onChange={(e) => setVerifySelectedTableId(Number(e.target.value))}
                    className="w-full bg-[#FAF8F5] border border-[#E4DCD0] rounded-lg px-3 py-2.5 text-xs font-medium text-[#261C18] focus:outline-hidden focus:border-[#B85B43] focus:bg-white transition-all cursor-pointer"
                  >
                    {(tableOverviews.length > 0
                      ? tableOverviews
                      : RESTAURANT_TABLES.map((t) => ({
                        table_id: t.id,
                        table_number: t.table_number,
                        capacity: t.capacity,
                        status: "Available",
                        active_session_count: 0,
                        total_sessions_today: 0,
                        sessions: [],
                      }))
                    ).map((tbl) => {
                      const floorInfo = getTableFloor(tbl.table_id);
                      const isOcc = tbl.status === "Occupied" || (tbl.sessions && tbl.sessions.some((s) => s.is_active));
                      return (
                        <option key={tbl.table_id} value={tbl.table_id} className="text-stone-900 bg-white py-1">
                          {floorInfo.name} — Table {floorInfo.floor_table_num} ({tbl.capacity || 4} Seats) {isOcc ? "• [Occupied / In Use]" : "• [Available]"}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmVerifyAndAllot}
                  disabled={isVerifyingAndAllotting}
                  className="flex-1 bg-[#261C18] hover:bg-[#B85B43] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{isVerifyingAndAllotting ? "Allotting Table..." : "Confirm & Allot Table"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVerifyingRes(null)}
                  disabled={isVerifyingAndAllotting}
                  className="px-3.5 py-2.5 border border-stone-200 hover:bg-stone-100 text-stone-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
