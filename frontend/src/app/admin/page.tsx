"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  IndianRupee,
  ScanLine,
  Calendar,
  Utensils,
  QrCode,
  FileText,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  ShieldCheck,
  Edit3,
  Plus,
  Trash2,
  Download,
  AlertCircle,
  ExternalLink,
  Store,
  Layers,
  CreditCard,
  Smartphone,
  Banknote,
  Sparkles,
  Eye,
  EyeOff,
  Check,
  Users,
  Receipt,
  RotateCw,
  SlidersHorizontal,
  AlertTriangle,
  UtensilsCrossed,
  Flame,
  CheckCircle2,
  ChevronDown,
  Package,
  FolderPlus,
  Zap,
  X,
} from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";
import { menuData, MENU_ITEM_ID_MAP, ITEM_MEDIA_MAP } from "@/data/menu";
import BrandTitle from "@/components/BrandTitle";
import TableQrPrinter from "@/components/admin/TableQrPrinter";
import { RESTAURANT_FLOORS, RESTAURANT_TABLES, getTableFloor, getFloorName } from "@/data/floors";
import { formatBookingId } from "@/lib/bookingId";
import { adminSession } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";

const {
  fetch: adminFetch,
  tokenKey: ADMIN_TOKEN_KEY,
  refreshKey: ADMIN_REFRESH_KEY,
  expiredEvent: ADMIN_SESSION_EXPIRED,
  refreshedEvent: ADMIN_TOKEN_REFRESHED,
} = adminSession;

interface DashboardMetrics {
  total_revenue: number;
  today_sales: number;
  yesterday_sales: number;
  week_sales: number;
  month_sales: number;
  total_kots: number;
  today_kots_count: number;
  active_tables: number;
  total_tables: number;
  avg_ticket_value: number;
}

interface SalesHistoryItem {
  date: string;
  raw_date: string;
  revenue: number;
  kots: number;
}

interface TopItem {
  name: string;
  price: number;
  quantity: number;
  revenue: number;
}

interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  description?: string;
  price: number | string;
  tax_rate: number | string;
  is_available: boolean;
  is_active: boolean;
  image_url?: string | null;
}

interface RawMaterial {
  id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  current_stock: string;
  reorder_threshold: string;
}

interface MenuCategory {
  id: number;
  name: string;
  display_order?: number;
  is_active?: boolean;
}

const INITIAL_CATEGORIES: MenuCategory[] = [
  { id: 1, name: "STARTERS" },
  { id: 2, name: "PRIMO" },
  { id: 3, name: "WOOD-FIRED NEAPOLITAN PIZZAS" },
  { id: 4, name: "CAKES" },
  { id: 5, name: "BEVERAGES" },
  { id: 6, name: "HOT DRINKS" },
];

const INITIAL_MENU_ITEMS: MenuItem[] = menuData.flatMap((c, catIdx) =>
  c.items.map((item, itemIdx) => {
    const backendId = MENU_ITEM_ID_MAP[item.id] || (catIdx + 1) * 100 + itemIdx + 1;
    return {
      id: backendId,
      category_id: catIdx + 1,
      name: item.name,
      description: item.description || "",
      price: item.price,
      tax_rate: "5.00",
      is_available: true,
      is_active: true,
    };
  })
);

interface Reservation {
  id: number;
  booking_id?: string;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  booking_date: string;
  reservation_date?: string;
  guest_count?: number;
  customer?: { name?: string; phone?: string; email?: string };
  time_slot: string;
  status: string;
  advance_amount: number | string;
  payment_status: string;
  upi_utr?: string;
  special_requests?: string;
  floor_number?: number;
  floor_name?: string;
  table_id?: number;
  table_name?: string;
  is_historical_limited?: boolean;
  cancellation_refund_amount?: number | string;
  cancellation_refund_status?: string;
}

interface TableOverview {
  id: number;
  table_number: string;
  capacity: number;
  qr_token: string;
  is_active: boolean;
  is_occupied?: boolean;
  active_session_count: number;
  floor_number?: number;
  floor_name?: string;
  floor_table_num?: number;
}

interface KOTRecord {
  id: number;
  kot_number: string;
  table_number: string;
  table_id?: number;
  status: string;
  printed_status: string;
  total_amount: number | string;
  items_count: number;
  created_at: string;
}

interface ScannedBillItem {
  id: number;
  inventory_item_id?: number;
  name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  subtotal: number;
}

interface ScannedBillRecord {
  id: number;
  bill_id: string;
  bill_number: string;
  supplier_name: string;
  supplier_id?: number;
  bill_date?: string | null;
  status: string;
  total_amount: number;
  items_count: number;
  created_at?: string | null;
  items: ScannedBillItem[];
}

interface CustomerBillRecord {
  id: number;
  bill_id: string;
  dining_session_id?: number;
  table_number: string;
  customer_name?: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  reservation_credit: number;
  total_amount: number;
  is_paid: boolean;
  payment_method: string;
  transaction_reference?: string | null;
  created_at?: string | null;
}

// The website's built-in picture for a dish (shown when no photo has been uploaded)
function defaultDishImage(dbId: number): string | null {
  const key = Object.keys(MENU_ITEM_ID_MAP).find((k) => MENU_ITEM_ID_MAP[k] === dbId);
  return (key && ITEM_MEDIA_MAP[key]?.image_url) || null;
}

const MAX_DISH_PHOTO_BYTES = 5 * 1024 * 1024;

// Shrink a phone photo (often 4-8 MB) to a ~1200px JPEG before upload so menus stay fast
async function shrinkDishPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob) return blob;
  } catch {
    // Browser can't read this format (e.g. HEIC on some devices); try the original file
  }
  return file;
}

// Set to true to bring back the shared "generalized" QR hub in the Table QR Codes tab
const SHOW_GENERALIZED_QR = false;

export default function AdminPortal() {
  const [token, setToken] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState("admin");
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<"analytics" | "operations" | "inventory" | "menu" | "reservations" | "tables" | "ledger">("analytics");

  // Helper for date string
  const getLocalDateString = (offsetDays = 0) => {
    const d = new Date();
    if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Operations Command Center State
  const [opDate, setOpDate] = useState<string>(() => getLocalDateString(0));
  const [opSubTab, setOpSubTab] = useState<"kots">("kots");
  const [opTableFilter, setOpTableFilter] = useState<"all" | "active" | "available">("all");
  const [opFloorFilter, setOpFloorFilter] = useState<number | "all">("all");
  const [opSummary, setOpSummary] = useState<any>(null);
  const [opTableOverviews, setOpTableOverviews] = useState<any[]>([]);
  const [opReservations, setOpReservations] = useState<any[]>([]);
  const [opKots, setOpKots] = useState<any[]>([]);
  const [opDough, setOpDough] = useState<any>(null);
  const [isOpLoading, setIsOpLoading] = useState(false);
  const [selectedOpTable, setSelectedOpTable] = useState<any | null>(null);

  const isOpToday = opDate === getLocalDateString(0);
  const isOpFuture = opDate > getLocalDateString(0);

  // Dashboard Data
  const [isLoading, setIsLoading] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [salesHistory, setSalesHistory] = useState<SalesHistoryItem[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<Record<string, number>>({});
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [reservationSummary, setReservationSummary] = useState<any>(null);

  // Menu Data - Pre-populated so admin UI is NEVER blank or empty
  const [menuItems, setMenuItems] = useState<MenuItem[]>(INITIAL_MENU_ITEMS);
  const [categories, setCategories] = useState<MenuCategory[]>(INITIAL_CATEGORIES);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<"" | "uploading" | "removing">("");
  const [photoError, setPhotoError] = useState("");
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [newItemData, setNewItemData] = useState({ name: "", category_id: 1, description: "", price: 350 });
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<number | "all">("all");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryData, setNewCategoryData] = useState({ name: "", display_order: 1 });
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [editCategoryData, setEditCategoryData] = useState({ name: "", display_order: 1 });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Reservations Data
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resSearch, setResSearch] = useState("");
  const [resDateFilter, setResDateFilter] = useState("");
  const [resFloorFilter, setResFloorFilter] = useState<number | "all">("all");
  const [selectedResDetails, setSelectedResDetails] = useState<Reservation | null>(null);

  // Tables Data & Generalized QR Data
  const [tables, setTables] = useState<TableOverview[]>([]);
  const [tableFloorFilter, setTableFloorFilter] = useState<number | "all">("all");
  const [qrModalTable, setQrModalTable] = useState<{ number: string; url: string; qrDataUrl: string } | null>(null);
  const [generalizedQrs, setGeneralizedQrs] = useState<Array<{ id: number; qr_token: string; is_active: boolean; created_at: string; notes?: string }>>([]);
  const [activeGenQr, setActiveGenQr] = useState<{ id: number; qr_token: string; is_active: boolean; created_at: string; notes?: string } | null>(null);
  const [activeGenQrDataUrl, setActiveGenQrDataUrl] = useState<string>("");
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrActionLoading, setQrActionLoading] = useState<string | null>(null);
  const [qrToDelete, setQrToDelete] = useState<{ qr_token: string; id?: number; name?: string } | null>(null);

  // Ledger / KOTs Data
  const [kots, setKots] = useState<KOTRecord[]>([]);

  // Billing & Finance Ledger Data
  const [scannedBills, setScannedBills] = useState<ScannedBillRecord[]>([]);
  const [customerBills, setCustomerBills] = useState<CustomerBillRecord[]>([]);
  const [ledgerSubTab, setLedgerSubTab] = useState<"inventory" | "sales">("inventory");
  const [selectedScannedBill, setSelectedScannedBill] = useState<ScannedBillRecord | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);

  // Analytics Chart State (Shadcn / Recharts)
  const [chartMetric, setChartMetric] = useState<"revenue" | "kots">("revenue");
  const [isChartMounted, setIsChartMounted] = useState(false);
  useEffect(() => {
    setIsChartMounted(true);
  }, []);

  const chartStats = useMemo(() => {
    if (!salesHistory.length) return { totalRev: 0, totalOrders: 0, avgDailyRev: 0, peakDay: null as SalesHistoryItem | null };
    const totalRev = salesHistory.reduce((sum, item) => sum + (Number(item.revenue) || 0), 0);
    const totalOrders = salesHistory.reduce((sum, item) => sum + (Number(item.kots) || 0), 0);
    const avgDailyRev = Math.round(totalRev / salesHistory.length);
    const peakDay = [...salesHistory].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))[0] || null;
    return { totalRev, totalOrders, avgDailyRev, peakDay };
  }, [salesHistory]);

  // Show Toast
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  // Base API resolution
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

  // Raw material inventory
  const [rawItems, setRawItems] = useState<RawMaterial[]>([]);
  const [rawSearch, setRawSearch] = useState("");
  const [rawLowOnly, setRawLowOnly] = useState(false);
  const [stockUpdate, setStockUpdate] = useState<{ item: RawMaterial; mode: "PURCHASE" | "WASTE" | "COUNT"; qty: string; ref: string } | null>(null);
  const [newRaw, setNewRaw] = useState<{ name: string; sku: string; unit: string; stock: string; reorder: string } | null>(null);

  // Supplier bill scanning: photo/PDF -> Sarvam reads it -> review -> confirm into stock
  type BillLine = {
    description: string;
    billQty: string;
    billUnit: string;
    amount: number | null;
    choice: string; // "MATCH:<id>" | "NEW" | "SKIP"
    quantity: string; // in the chosen material's unit
    unitCost: string; // INR per material unit
    unitCheck: boolean; // bill unit couldn't be converted to the material's unit
    newName: string;
    newUnit: string;
  };
  const [billScan, setBillScan] = useState<{
    stage: "pick" | "scanning" | "review" | "saving";
    error?: string;
    supplier: string;
    billNumber: string;
    billDate: string;
    grandTotal: number | null;
    lines: BillLine[];
  } | null>(null);

  const handleScanBill = async (file: File) => {
    if (!token) return;
    setBillScan((p) => (p ? { ...p, stage: "scanning", error: undefined } : p));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await adminFetch(`${getApiBase()}/api/v1/inventory/bills/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBillScan((p) => (p ? { ...p, stage: "pick", error: typeof data.detail === "string" ? data.detail : "Could not read the bill." } : p));
        return;
      }
      const units = ["kg", "g", "l", "ml", "pcs"];
      const lines: BillLine[] = (data.lines || []).map((l: any) => {
        const matched = l.suggested_material_id ? rawItems.find((r) => r.id === l.suggested_material_id) : undefined;
        const qty = Number(matched && l.stock_quantity != null ? l.stock_quantity : l.quantity || 0);
        const amount = l.amount != null ? Number(l.amount) : null;
        const billUnit = String(l.unit || "").toLowerCase().replace(/[^a-z]/g, "");
        const normUnit = ({ ltr: "l", ltrs: "l", litre: "l", liter: "l", kgs: "kg", gm: "g", gms: "g", nos: "pcs", pc: "pcs" } as Record<string, string>)[billUnit] || billUnit;
        return {
          description: l.description || "",
          billQty: l.quantity != null ? String(Number(l.quantity)) : "",
          billUnit: l.unit || "",
          amount,
          choice: matched ? `MATCH:${matched.id}` : "NEW",
          quantity: qty ? String(qty) : "",
          unitCost: amount != null && qty ? (amount / qty).toFixed(2) : l.unit_price != null ? String(Number(l.unit_price)) : "",
          unitCheck: !!matched && l.stock_quantity == null,
          newName: l.description || "",
          newUnit: units.includes(normUnit) ? normUnit : "kg",
        };
      });
      setBillScan({
        stage: "review",
        supplier: data.supplier_name || "",
        billNumber: data.bill_number || "",
        billDate: /^\d{4}-\d{2}-\d{2}$/.test(data.bill_date || "") ? data.bill_date : "",
        grandTotal: data.grand_total != null ? Number(data.grand_total) : null,
        lines,
      });
    } catch {
      setBillScan((p) => (p ? { ...p, stage: "pick", error: "Network error while reading the bill." } : p));
    }
  };

  const updateBillLine = (idx: number, patch: Partial<BillLine>) =>
    setBillScan((p) => (p ? { ...p, lines: p.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) } : p));

  const handleConfirmBill = async () => {
    if (!billScan || !token) return;
    if (!billScan.supplier.trim() || !billScan.billNumber.trim()) {
      setBillScan({ ...billScan, error: "Supplier name and bill number are required." });
      return;
    }
    const lines = billScan.lines.map((l) => {
      if (l.choice === "SKIP") return { action: "SKIP", description: l.description };
      const base = { description: l.description, quantity: Number(l.quantity) || 0, unit_cost: Number(l.unitCost) || 0 };
      if (l.choice === "NEW") return { ...base, action: "NEW", new_name: l.newName.trim(), new_unit: l.newUnit };
      return { ...base, action: "MATCH", inventory_item_id: Number(l.choice.split(":")[1]) };
    });
    setBillScan({ ...billScan, stage: "saving", error: undefined });
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/inventory/bills/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          supplier_name: billScan.supplier.trim(),
          bill_number: billScan.billNumber.trim(),
          bill_date: billScan.billDate || null,
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.detail === "string" ? data.detail.replace(/^[A-Z_]+: /, "") : "Could not save the bill.";
        setBillScan((p) => (p ? { ...p, stage: "review", error: msg } : p));
        return;
      }
      showToast(`Bill ${billScan.billNumber} added: ${data.items_received} items, ₹${Number(data.total_cost).toLocaleString("en-IN")}`);
      setBillScan(null);
      fetchRawItems();
      fetchLedgerBills();
    } catch {
      setBillScan((p) => (p ? { ...p, stage: "review", error: "Network error while saving the bill." } : p));
    }
  };

  const fetchRawItems = useCallback(async () => {
    if (!token) return;
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/inventory`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setRawItems(await res.json());
      else showToast("Could not load raw material inventory");
    } catch {
      showToast("Network error loading inventory");
    }
  }, [token]);

  const fetchLedgerBills = useCallback(async () => {
    if (!token) return;
    setIsLedgerLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [invRes, custRes] = await Promise.allSettled([
        adminFetch(`${getApiBase()}/api/v1/inventory/bills`, { headers }),
        adminFetch(`${getApiBase()}/api/v1/bills`, { headers }),
      ]);
      if (invRes.status === "fulfilled" && invRes.value.ok) {
        const invData = await invRes.value.json();
        if (Array.isArray(invData)) setScannedBills(invData);
      }
      if (custRes.status === "fulfilled" && custRes.value.ok) {
        const custData = await custRes.value.json();
        if (Array.isArray(custData)) setCustomerBills(custData);
      }
    } catch (err) {
      console.warn("Ledger bills fetch error:", err);
    } finally {
      setIsLedgerLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === "inventory") fetchRawItems();
    if (activeTab === "ledger") fetchLedgerBills();
  }, [activeTab, fetchRawItems, fetchLedgerBills]);

  const handleStockUpdate = async () => {
    if (!stockUpdate || !token) return;
    const qty = Number(stockUpdate.qty);
    if (!Number.isFinite(qty) || qty < 0 || (stockUpdate.mode !== "COUNT" && qty === 0)) {
      showToast("Enter a valid quantity");
      return;
    }
    const current = Number(stockUpdate.item.current_stock);
    const change = stockUpdate.mode === "PURCHASE" ? qty : stockUpdate.mode === "WASTE" ? -qty : qty - current;
    if (stockUpdate.mode === "WASTE" && qty > current) {
      showToast("Cannot remove more than is in stock");
      return;
    }
    if (change === 0) {
      setStockUpdate(null);
      return;
    }
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/inventory/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          inventory_item_id: stockUpdate.item.id,
          transaction_type: stockUpdate.mode === "COUNT" ? "ADJUSTMENT" : stockUpdate.mode,
          quantity_change: change,
          reference_id: stockUpdate.ref.trim() || null,
        }),
      });
      if (res.ok) {
        showToast(`${stockUpdate.item.name} stock updated`);
        setStockUpdate(null);
        fetchRawItems();
      } else {
        showToast("Failed to update stock");
      }
    } catch {
      showToast("Network error updating stock");
    }
  };

  const handleCreateRawItem = async () => {
    if (!newRaw || !token) return;
    const stock = Number(newRaw.stock || 0);
    const reorder = Number(newRaw.reorder || 0);
    if (!newRaw.name.trim() || !newRaw.sku.trim() || !(stock >= 0) || !(reorder >= 0)) {
      showToast("Name, SKU and valid quantities are required");
      return;
    }
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/inventory/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newRaw.name.trim(),
          sku: newRaw.sku.trim().toUpperCase(),
          unit_of_measure: newRaw.unit,
          current_stock: stock,
          reorder_threshold: reorder,
        }),
      });
      if (res.ok) {
        showToast(`${newRaw.name.trim()} added to inventory`);
        setNewRaw(null);
        fetchRawItems();
      } else {
        showToast("Failed to add raw material (SKU may already exist)");
      }
    } catch {
      showToast("Network error adding raw material");
    }
  };

  // Check stored token (validates 5-hour expiration)
  useEffect(() => {
    const savedToken = adminSession.getValidToken();
    if (savedToken) {
      setToken(savedToken);
    } else {
      setToken(null);
    }
  }, []);

  // Fetch menu data independently (works with or without token)
  const fetchMenuData = useCallback(async () => {
    const apiBase = getApiBase();
    try {
      const [catRes, itemRes] = await Promise.all([
        adminFetch(`${apiBase}/api/v1/menu/categories`),
        adminFetch(`${apiBase}/api/v1/menu/items`),
      ]);
      if (catRes.ok) {
        const catData = await catRes.json();
        if (Array.isArray(catData) && catData.length > 0) {
          setCategories(catData);
        }
      }
      if (itemRes.ok) {
        const dbItems = await itemRes.json();
        if (Array.isArray(dbItems) && dbItems.length > 0) {
          // The database is the source of truth; the built-in menu is only a fallback when the API is down.
          // (Merging by id attached built-in names to the wrong database rows once ids drifted.)
          setMenuItems(
            dbItems.map((it: any) => ({
              id: Number(it.id),
              category_id: Number(it.category_id),
              name: it.name,
              description: it.description || "",
              price: Number(it.price),
              tax_rate: it.tax_rate || "5.00",
              is_available: Boolean(it.is_available),
              is_active: it.is_active !== undefined ? Boolean(it.is_active) : true,
              image_url: it.image_url || null,
            }))
          );
        }
      }
    } catch (err) {
      console.warn("Live menu sync fallback:", err);
    }
  }, []);

  // Fetch all dashboard data
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    const apiBase = getApiBase();
    const headers = { Authorization: `Bearer ${token}` };
    const requests = token ? Promise.allSettled([
      adminFetch(`${apiBase}/api/v1/analytics/dashboard`, { headers }),
      adminFetch(`${apiBase}/api/v1/reservations`, { headers }),
      adminFetch(`${apiBase}/api/v1/tables`, { headers }),
      adminFetch(`${apiBase}/api/v1/pos/kots`, { headers }),
    ]) : null;

    // 1. Always sync menu
    await fetchMenuData();

    if (!token) {
      if (!silent) setIsLoading(false);
      return;
    }
    const responses = await requests!;

    // 2. Analytics Dashboard (Protected)
    try {
      const anaRes = responses[0].status === "fulfilled" ? responses[0].value : null;
      if (anaRes?.ok) {
        const data = await anaRes.json();
        if (data.metrics) setMetrics(data.metrics);
        if (data.sales_history) setSalesHistory(data.sales_history || []);
        if (data.payment_breakdown) setPaymentBreakdown(data.payment_breakdown || {});
        if (data.top_items) setTopItems(data.top_items || []);
        if (data.reservation_summary) setReservationSummary(data.reservation_summary || {});
      }
    } catch (err) {
      console.warn("Analytics fetch error:", err);
    }

    // 3. Reservations (Protected)
    try {
      const rRes = responses[1].status === "fulfilled" ? responses[1].value : null;
      if (rRes?.ok) {
        const rData = await rRes.json();
        if (Array.isArray(rData)) {
          setReservations(
            rData.map((r: any) => {
              const floorInfo = getTableFloor(r.table_id || r.table_name || 1);
              const canonicalId = r.booking_id || formatBookingId(r.customer?.name, r.customer?.phone, r.id);
              return {
                id: r.id,
                booking_id: canonicalId,
                customer_name: r.customer?.name || "Guest",
                customer_phone: r.customer?.phone || "",
                party_size: r.guest_count || 2,
                booking_date: r.reservation_date || "",
                time_slot: r.time_slot || "",
                status: r.status || "CONFIRMED",
                advance_amount: r.advance_amount || 0,
                payment_status: r.payment_status || "PAID",
                upi_utr: r.upi_utr || "",
                special_requests: r.special_requests || "",
                floor_number: r.floor_number || floorInfo.floor,
                floor_name: r.floor_number ? getFloorName(r.floor_number) : floorInfo.name,
                table_id: r.table_id,
                table_name: r.table_name || (r.table_id ? `Table ${r.table_id}` : "Auto Assigned"),
                is_historical_limited: Boolean(r.is_historical_limited),
                cancellation_refund_amount: r.cancellation_refund_amount ?? 0,
                cancellation_refund_status: r.cancellation_refund_status ?? undefined,
              };
            })
          );
        }
      }
    } catch (err) {
      console.warn("Reservations fetch error:", err);
    }

    // 4. Tables (Protected)
    try {
      const tRes = responses[2].status === "fulfilled" ? responses[2].value : null;
      if (tRes?.ok) {
        const tData = await tRes.json();
        if (Array.isArray(tData)) {
          setTables(
            tData.map((t: any) => {
              const fl = getTableFloor(t.id, t.floor_number);
              const relNum = t.floor_table_num || fl.floor_table_num;
              return {
                id: t.id,
                table_number: `Table ${relNum}`,
                floor_table_num: relNum,
                capacity: t.capacity || fl.capacity,
                qr_token: t.qr_token || `qr_sec_${t.id}`,
                is_active: t.status !== "Maintenance",
                active_session_count: t.status === "Occupied" ? 1 : 0,
                floor_number: t.floor_number || fl.floor,
                floor_name: t.floor_name || fl.name,
              };
            })
          );
        }
      }
    } catch (err) {
      console.warn("Tables fetch error:", err);
    }

    // 5. KOTs / Ledger (Protected)
    try {
      const kRes = responses[3].status === "fulfilled" ? responses[3].value : null;
      if (kRes?.ok) {
        const kData = await kRes.json();
        if (Array.isArray(kData)) setKots(kData);
      }
    } catch (err) {
      console.warn("KOTs fetch error:", err);
    }

    // 6. Billing & Finance Ledger
    try {
      fetchLedgerBills();
    } catch (err) {
      console.warn("Ledger fetch error:", err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [token, fetchMenuData, fetchLedgerBills]);

  // Initial menu sync on mount
  useEffect(() => {
    fetchMenuData();
  }, [fetchMenuData]);

  // Trigger full dashboard fetch when token is ready
  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token, fetchData]);

  // Fetch Operations Data for target date (silent mode prevents loading flash on background sync)
  const fetchOperationsData = useCallback(
    async (targetDate?: string, silent = false) => {
      if (!token) return;
      if (!silent) setIsOpLoading(true);
      const target = targetDate || opDate;
      const apiBase = getApiBase();
      const headers = { Authorization: `Bearer ${token}` };
      const dateParam = target ? `?target_date=${target}` : "";
      try {
        const [sumRes, tablesRes, kotsRes, doughRes, resRes] = await Promise.all([
          adminFetch(`${apiBase}/api/v1/pos/summary${dateParam}`, { headers }),
          adminFetch(`${apiBase}/api/v1/pos/table-sessions${dateParam}`, { headers }),
          adminFetch(`${apiBase}/api/v1/pos/kots${dateParam}`, { headers }),
          adminFetch(`${apiBase}/api/v1/pos/daily-dough-capacity${target ? `?target_date=${target}` : ""}`, { headers }),
          adminFetch(`${apiBase}/api/v1/reservations${target ? `?reservation_date=${target}` : ""}`, { headers }),
        ]);

        if (sumRes.ok) {
          const sumData = await sumRes.json();
          setOpSummary(sumData);
        }
        if (tablesRes.ok) {
          const tablesData = await tablesRes.json();
          setOpTableOverviews(Array.isArray(tablesData) ? tablesData : []);
        }
        if (kotsRes.ok) {
          const kotsData = await kotsRes.json();
          setOpKots(Array.isArray(kotsData) ? kotsData : []);
        }
        if (doughRes.ok) {
          const doughData = await doughRes.json();
          setOpDough(doughData);
        }
        if (resRes.ok) {
          const resData = await resRes.json();
          setOpReservations(Array.isArray(resData) ? resData : []);
        }
      } catch (err) {
        console.warn("Operations data fetch error:", err);
      } finally {
        if (!silent) setIsOpLoading(false);
      }
    },
    [token, opDate]
  );

  useEffect(() => {
    if (token) {
      fetchOperationsData(opDate);
    }
  }, [token, opDate, fetchOperationsData]);

  // Generalized QR Code Management Handlers with resilient fallback & sync
  const fetchGeneralizedQrs = useCallback(async () => {
    if (!token) return;
    setIsQrLoading(true);
    try {
      const apiBase = getApiBase();
      let active: any = null;
      let all: any[] = [];

      try {
        const res = await adminFetch(`${apiBase}/api/v1/tables/qr/generalized`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          all = data.all_qrs || [];
          active = data.active_qr || (all.length > 0 ? all[0] : null);
        }
      } catch {
        // Fall through to client-side fallback
      }

      // Fallback: If backend routes not yet responding, use localStorage or Table 1 token
      if (!active && all.length === 0) {
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem("jaadoo_generalized_qrs");
          if (saved) {
            try {
              all = JSON.parse(saved);
              active = all.find((q: any) => q.is_active) || all[0];
            } catch {}
          }
        }
      }

      // If still empty, seed with Table 1's active QR from /tables or default token
      if (!active && all.length === 0) {
        let t1Token = "qr_sec_b7ba9c59d35e4074a30034abb48ee0a9";
        try {
          const tblRes = await adminFetch(`${apiBase}/api/v1/tables`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (tblRes.ok) {
            const tbls = await tblRes.json();
            if (tbls && tbls[0]?.qr_code?.qr_token) {
              t1Token = tbls[0].qr_code.qr_token;
            }
          }
        } catch {}

        active = {
          id: 1,
          qr_token: t1Token,
          is_active: true,
          created_at: new Date().toISOString(),
          notes: "Generalized Dining Hub (Primary)",
        };
        all = [active];
        if (typeof window !== "undefined") {
          localStorage.setItem("jaadoo_generalized_qrs", JSON.stringify(all));
        }
      }

      setGeneralizedQrs(all);
      setActiveGenQr(active);

      if (active?.qr_token) {
        const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-piza.vercel.app";
        const orderUrl = `${origin}/table/${active.qr_token}`;
        const qrDataUrl = await QRCode.toDataURL(orderUrl, {
          width: 380,
          margin: 2,
          color: { dark: "#2C1E16", light: "#FFFFFF" },
        });
        setActiveGenQrDataUrl(qrDataUrl);
      }
    } catch (err) {
      console.warn("Generalized QRs fetch error:", err);
    } finally {
      setIsQrLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token && SHOW_GENERALIZED_QR) {
      fetchGeneralizedQrs();
    }
  }, [token, fetchGeneralizedQrs]);

  const handleGenerateFreshQr = async () => {
    if (!token) return;
    setQrActionLoading("generate");
    try {
      const apiBase = getApiBase();
      let freshQr: any = null;

      // 1. Try backend specialized endpoint
      try {
        const res = await adminFetch(`${apiBase}/api/v1/tables/qr/generalized/generate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          freshQr = await res.json();
        }
      } catch {}

      // 2. Fallback: Rotate Table 1's QR code on backend
      if (!freshQr) {
        try {
          const rotRes = await adminFetch(`${apiBase}/api/v1/tables/1/qr/rotate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (rotRes.ok) {
            const rotData = await rotRes.json();
            if (rotData?.qr_token) {
              freshQr = {
                id: rotData.id || Date.now(),
                qr_token: rotData.qr_token,
                is_active: true,
                created_at: rotData.created_at || new Date().toISOString(),
                notes: "Generalized Dining Hub",
              };
            }
          }
        } catch {}
      }

      // 3. Fallback: Generate secure fresh token locally
      if (!freshQr) {
        const rawId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2) + Date.now().toString(36);
        freshQr = {
          id: Date.now(),
          qr_token: `qr_sec_${rawId}`,
          is_active: true,
          created_at: new Date().toISOString(),
          notes: "Generalized Dining Hub",
        };
      }

      // Multiple QRs can remain active simultaneously
      const updatedList = [freshQr, ...generalizedQrs];
      setGeneralizedQrs(updatedList);
      setActiveGenQr(freshQr);

      if (typeof window !== "undefined") {
        localStorage.setItem("jaadoo_generalized_qrs", JSON.stringify(updatedList));
      }

      if (freshQr?.qr_token) {
        const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-piza.vercel.app";
        const orderUrl = `${origin}/table/${freshQr.qr_token}`;
        const qrDataUrl = await QRCode.toDataURL(orderUrl, {
          width: 380,
          margin: 2,
          color: { dark: "#2C1E16", light: "#FFFFFF" },
        });
        setActiveGenQrDataUrl(qrDataUrl);
      }

      setToastMessage("Fresh Generalized QR Code generated successfully!");
      setTimeout(() => setToastMessage(null), 3000);
      if (freshQr?.qr_token) {
        handleOpenGeneralizedQrPrint(freshQr.qr_token, "Generalized Table QR");
      }
    } catch {
      toast.error("Network error while generating QR code.");
    } finally {
      setQrActionLoading(null);
    }
  };

  const confirmDeleteQr = async () => {
    if (!token || !qrToDelete) return;
    const { qr_token: qrToken, id } = qrToDelete;
    setQrActionLoading(`del_${qrToken}`);
    try {
      const apiBase = getApiBase();
      try {
        await adminFetch(`${apiBase}/api/v1/tables/qr/generalized?qr_token=${encodeURIComponent(qrToken)}&id=${id || ""}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}

      const updatedList = generalizedQrs.filter((item) => (id ? item.id !== id : item.qr_token !== qrToken));
      setGeneralizedQrs(updatedList);

      if (typeof window !== "undefined") {
        localStorage.setItem("jaadoo_generalized_qrs", JSON.stringify(updatedList));
      }

      if (activeGenQr && ((id && activeGenQr.id === id) || activeGenQr.qr_token === qrToken)) {
        const nextActive = updatedList.find((item) => item.is_active) || updatedList[0] || null;
        setActiveGenQr(nextActive);
        if (nextActive?.qr_token) {
          const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-piza.vercel.app";
          const orderUrl = `${origin}/table/${nextActive.qr_token}`;
          const qrDataUrl = await QRCode.toDataURL(orderUrl, {
            width: 380,
            margin: 2,
            color: { dark: "#2C1E16", light: "#FFFFFF" },
          });
          setActiveGenQrDataUrl(qrDataUrl);
        } else {
          setActiveGenQrDataUrl("");
        }
      }

      setToastMessage("QR code deleted successfully!");
      setTimeout(() => setToastMessage(null), 3000);
      setQrToDelete(null);
    } catch {
      toast.error("Failed to delete QR code.");
    } finally {
      setQrActionLoading(null);
    }
  };

  const handleToggleQrStatus = async (qrToken: string, currentStatus: boolean, id?: number) => {
    if (!token) return;
    setQrActionLoading(qrToken);
    try {
      const apiBase = getApiBase();
      let updatedStatus = !currentStatus;

      // 1. Try backend toggle endpoint
      try {
        const res = await adminFetch(`${apiBase}/api/v1/tables/qr/generalized/toggle-status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            qr_token: qrToken,
            id,
            is_active: updatedStatus,
          }),
        });
        if (res.ok) {
          const resData = await res.json();
          updatedStatus = resData.is_active;
        }
      } catch {}

      // Update local state and persistence
      const updatedList = generalizedQrs.map((item) => {
        if ((id && item.id === id) || item.qr_token === qrToken) {
          return { ...item, is_active: updatedStatus };
        }
        return item;
      });

      setGeneralizedQrs(updatedList);
      if (activeGenQr && ((id && activeGenQr.id === id) || activeGenQr.qr_token === qrToken)) {
        setActiveGenQr({ ...activeGenQr, is_active: updatedStatus });
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("jaadoo_generalized_qrs", JSON.stringify(updatedList));
      }

      setToastMessage(updatedStatus ? "QR code activated!" : "QR code deactivated!");
      setTimeout(() => setToastMessage(null), 3000);
    } catch {
      toast.error("Network error while updating QR status.");
    } finally {
      setQrActionLoading(null);
    }
  };

  const handleOpenGeneralizedQrPrint = async (qrToken: string, label?: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-piza.vercel.app";
    const orderUrl = `${origin}/table/${qrToken}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(orderUrl, {
        width: 400,
        margin: 2,
        color: { dark: "#2C1E16", light: "#FFFFFF" },
      });
      setQrModalTable({
        number: label || "General Dining",
        url: orderUrl,
        qrDataUrl,
      });
    } catch {
      toast.error("Failed to render QR Code.");
    }
  };

  // Dashboard revenue filters (each card queries /analytics/revenue for its own business-date range)
  type RevenueFigure = { revenue: number; kots: number } | null;
  const isoDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shiftDays = (iso: string, days: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    return isoDate(new Date(y, m - 1, d + days));
  };
  const shortDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };
  const todayIso = isoDate(new Date());
  const [revDay, setRevDay] = useState(todayIso);
  const [revWeekEnd, setRevWeekEnd] = useState(todayIso);
  const [revMonth, setRevMonth] = useState(todayIso.slice(0, 7));
  const [revYear, setRevYear] = useState(todayIso.slice(0, 4));
  const [revFigures, setRevFigures] = useState<Record<"day" | "prevDay" | "week" | "month" | "year", RevenueFigure>>({
    day: null,
    prevDay: null,
    week: null,
    month: null,
    year: null,
  });

  const fetchRevenue = useCallback(
    async (start: string, end: string): Promise<RevenueFigure> => {
      if (!token) return null;
      try {
        const res = await adminFetch(`${getApiBase()}/api/v1/analytics/revenue?start=${start}&end=${end}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    const [y, m] = revMonth.split("-").map(Number);
    const monthEnd = isoDate(new Date(y, m, 0));
    Promise.all([
      fetchRevenue(revDay, revDay),
      fetchRevenue(shiftDays(revDay, -1), shiftDays(revDay, -1)),
      fetchRevenue(shiftDays(revWeekEnd, -6), revWeekEnd),
      fetchRevenue(`${revMonth}-01`, monthEnd),
      fetchRevenue(`${revYear}-01-01`, `${revYear}-12-31`),
    ]).then(([day, prevDay, week, month, year]) => setRevFigures({ day, prevDay, week, month, year }));
  }, [token, revDay, revWeekEnd, revMonth, revYear, fetchRevenue, metrics]); // metrics: refetch whenever the dashboard refreshes

  // Cancel a reservation via the backend cancellation policy (computes refund, releases dough & reminders)
  const [confirmCancelRes, setConfirmCancelRes] = useState(false);
  const [isCancellingRes, setIsCancellingRes] = useState(false);

  const handleCancelReservation = async (resId: number) => {
    if (!token) return;
    setIsCancellingRes(true);
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/reservations/${resId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(`Cannot cancel: ${String(data.detail || "Server error").replace("INVALID_STATUS_TRANSITION: ", "")}`);
        return;
      }
      const refund = Number(data.cancellation_refund_amount || 0);
      setSelectedResDetails((prev) =>
        prev && prev.id === resId
          ? {
            ...prev,
            status: data.status,
            payment_status: data.payment_status,
            cancellation_refund_amount: data.cancellation_refund_amount,
            cancellation_refund_status: data.cancellation_refund_status,
          }
          : prev
      );
      setConfirmCancelRes(false);
      showToast(
        refund > 0
          ? `Reservation cancelled. Refund due to guest: ₹${refund.toFixed(2)}`
          : "Reservation cancelled. No refund due under the cancellation policy."
      );
      await Promise.all([fetchOperationsData(opDate, true), fetchData(true)]);
    } catch {
      showToast("Network error cancelling reservation");
    } finally {
      setIsCancellingRes(false);
    }
  };

  // Guest Arrived = check in + seat in one step: opens/links the table's bill session and credits the deposit
  const [arrivalTableId, setArrivalTableId] = useState<number | "">("");
  const [isCheckingIn, setIsCheckingIn] = useState(false);

  // Open the details popup with fresh per-booking UI state (no leftover cancel confirm / table pick)
  const openReservationDetails = (r: Reservation) => {
    setConfirmCancelRes(false);
    setArrivalTableId("");
    setSelectedResDetails(r);
  };

  const handleGuestArrived = async (r: Reservation) => {
    if (!token) return;
    const tableId = r.table_id || (arrivalTableId === "" ? undefined : arrivalTableId);
    if (!tableId) {
      showToast("Choose a table for this guest first");
      return;
    }
    setIsCheckingIn(true);
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/reservations/${r.id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ table_id: tableId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(String(data.detail || "Could not check the guest in").replace(/^[A-Z_]+: /, ""));
        return;
      }
      const tbl = RESTAURANT_TABLES.find((t) => t.id === tableId);
      setSelectedResDetails((prev) =>
        prev && prev.id === r.id
          ? {
            ...prev,
            status: data.status || "SEATED",
            table_id: tableId,
            table_name: data.table_name || tbl?.table_number || prev.table_name,
            floor_number: tbl?.floor || prev.floor_number,
            floor_name: tbl ? getFloorName(tbl.floor) : prev.floor_name,
          }
          : prev
      );
      setArrivalTableId("");
      showToast(`${r.customer_name} checked in and seated at ${tbl ? `${tbl.table_number} (${getFloorName(tbl.floor)})` : "their table"}`);
      await Promise.all([fetchOperationsData(opDate, true), fetchData(true)]);
    } catch {
      showToast("Network error checking the guest in");
    } finally {
      setIsCheckingIn(false);
    }
  };

  // Handle seating and reservation status update with live session check-in
  const handleUpdateOpReservationStatus = async (resId: number, newStatus: string) => {
    if (!token) return;
    const previousOpReservations = opReservations;
    const previousReservations = reservations;
    setOpReservations((prev) => prev.map((reservation) => reservation.id === resId ? { ...reservation, status: newStatus } : reservation));
    setReservations((prev) => prev.map((reservation) => reservation.id === resId ? { ...reservation, status: newStatus } : reservation));
    const apiBase = getApiBase();
    try {
      if (newStatus === "SEATED") {
        const targetRes = opReservations.find((r) => r.id === resId) || reservations.find((r) => r.id === resId);
        if (targetRes && targetRes.table_id) {
          const checkinRes = await adminFetch(`${apiBase}/api/v1/reservations/${resId}/checkin`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ table_id: targetRes.table_id }),
          });
          if (checkinRes.ok) {
            showToast(`Reservation #${resId} checked in & seated at Table #${targetRes.table_id}`);
            await Promise.all([fetchOperationsData(opDate, true), fetchData(true)]);
            return true;
          }
        }
      }

      const res = await adminFetch(`${apiBase}/api/v1/reservations/${resId}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`Reservation #${resId} marked as ${newStatus}`);
        await Promise.all([fetchOperationsData(opDate, true), fetchData(true)]);
        return true;
      } else {
        setOpReservations(previousOpReservations);
        setReservations(previousReservations);
        showToast(`Failed to update reservation #${resId}`);
      }
    } catch {
      setOpReservations(previousOpReservations);
      setReservations(previousReservations);
      showToast("Error updating reservation status");
    }
    return false;
  };

  // Real-time multi-channel WebSocket connection for live sync + background poll
  useEffect(() => {
    const wsBase = getWsBase();
    const channels = ["pos", "tables", "menu", "admin"];
    const sockets: WebSocket[] = [];
    let isCleanedUp = false;
    let reconnectTimeout: any = null;

    const connectAll = () => {
      if (isCleanedUp || !wsBase) return;
      channels.forEach((ch) => {
        try {
          const ws = new WebSocket(`${wsBase}/ws/${ch}`);
          sockets.push(ws);

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === "PONG") return;

              // Menu modifications
              if (data.type === "MENU_UPDATED") {
                fetchMenuData();
                showToast(`Live Update: ${data.name || "Menu"} was modified`);
              }

              // Kitchen / KOT / Order / Session / Reservation events from POS or system
              if (
                data.event === "KOT_CREATED" ||
                data.event === "KOT_UPDATED" ||
                data.event === "SESSION_CLOSED" ||
                data.event === "SESSIONS_RESET" ||
                data.event === "ORDER_CREATED" ||
                data.event === "RESERVATION_CREATED" ||
                data.event === "RESERVATION_UPDATED" ||
                data.event === "TABLE_UPDATED" ||
                data.type === "RESERVATION_CREATED" ||
                data.type === "RESERVATION_UPDATED"
              ) {
                // Silently refresh operations and dashboard data
                fetchOperationsData(opDate, true);
                fetchData(true);
              }
            } catch { }
          };
        } catch { }
      });
    };

    connectAll();

    // Reconnection check
    const checkConnection = () => {
      const anyOpen = sockets.some((s) => s.readyState === WebSocket.OPEN);
      if (!anyOpen && !isCleanedUp) {
        sockets.forEach((s) => {
          try { s.close(); } catch { }
        });
        sockets.length = 0;
        reconnectTimeout = setTimeout(connectAll, 4000);
      }
    };
    const healthInterval = setInterval(checkConnection, 10000);

    // WebSockets provide immediate updates; poll less often as a fallback.
    const pollInterval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (token) {
        fetchData(true);
        fetchOperationsData(opDate, true);
      } else {
        fetchMenuData();
      }
    }, 30000);

    return () => {
      isCleanedUp = true;
      sockets.forEach((s) => {
        try { s.close(); } catch { }
      });
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(healthInterval);
      clearInterval(pollInterval);
    };
  }, [token, opDate, fetchData, fetchOperationsData, fetchMenuData]);

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const apiBase = getApiBase();
      const res = await adminFetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          password: passwordInput,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoginError(err.detail || "Invalid owner credentials. Please try again.");
        setIsLoggingIn(false);
        return;
      }

      const data = await res.json();
      setToken(data.access_token);
      adminSession.setTokens(data.access_token, data.refresh_token);
    } catch {
      setLoginError("Could not reach backend server. Please verify network connection.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout handler
  const handleLogout = () => {
    adminSession.clearSession();
    setToken(null);
  };

  // Keep React state in sync with adminFetch: renewed token, or session that could not be renewed
  useEffect(() => {
    const onRefreshed = (e: Event) => setToken((e as CustomEvent<string>).detail);
    const onExpired = () => {
      adminSession.clearSession();
      setToken(null);
      setLoginError("Your session expired after 5 hours. Please log in again.");
    };
    window.addEventListener(ADMIN_TOKEN_REFRESHED, onRefreshed);
    window.addEventListener(ADMIN_SESSION_EXPIRED, onExpired);
    return () => {
      window.removeEventListener(ADMIN_TOKEN_REFRESHED, onRefreshed);
      window.removeEventListener(ADMIN_SESSION_EXPIRED, onExpired);
    };
  }, []);

  // Update menu item (Price, name, description, availability)
  // Dish photo: saved immediately (separately from the name/price form)
  const applyDishPhoto = (itemId: number, imageUrl: string | null) => {
    setMenuItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, image_url: imageUrl } : i)));
    setEditingItem((prev) => (prev && prev.id === itemId ? { ...prev, image_url: imageUrl } : prev));
  };

  const handleDishPhotoSelected = async (item: MenuItem, file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose a photo (JPG, PNG or WebP).");
      return;
    }
    setPhotoBusy("uploading");
    try {
      const photo = await shrinkDishPhoto(file);
      if (photo.size > MAX_DISH_PHOTO_BYTES) {
        setPhotoError("This photo is too large. Please choose one under 5 MB.");
        return;
      }
      const form = new FormData();
      form.append("file", photo, "dish.jpg");
      const res = await adminFetch(`${getApiBase()}/api/v1/menu/items/${item.id}/image`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoError(typeof data.detail === "string" ? data.detail : "Could not upload the photo. Please try again.");
        return;
      }
      applyDishPhoto(item.id, data.image_url);
      showToast(`Photo updated for ${item.name}`);
    } catch {
      setPhotoError("Network error while uploading. Please check your connection and try again.");
    } finally {
      setPhotoBusy("");
    }
  };

  const handleRemoveDishPhoto = async (item: MenuItem) => {
    if (!confirm(`Remove the uploaded photo for ${item.name}? The website will show its default picture again.`)) return;
    setPhotoError("");
    setPhotoBusy("removing");
    try {
      const res = await adminFetch(`${getApiBase()}/api/v1/menu/items/${item.id}/image`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setPhotoError("Could not remove the photo. Please try again.");
        return;
      }
      applyDishPhoto(item.id, null);
      showToast(`Photo removed for ${item.name}`);
    } catch {
      setPhotoError("Network error while removing the photo. Please try again.");
    } finally {
      setPhotoBusy("");
    }
  };

  const handleSaveMenuItem = async (item: MenuItem) => {
    if (!item) return;
    const apiBase = getApiBase();
    setIsSavingItem(true);

    // Optimistic local update for instant UI feedback
    setMenuItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ...item, price: Number(item.price) } : i))
    );

    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/items/${item.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: item.name,
          description: item.description,
          price: Number(item.price),
          is_available: Boolean(item.is_available),
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setMenuItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, ...updated, price: Number(updated.price) } : i))
        );
        setEditingItem(null);
        showToast(`Saved: ${item.name} is now ₹${item.price} (${item.is_available ? "In Stock" : "86'd"})`);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`Failed to update item: ${err.detail || res.statusText || "Server error"}`);
        fetchData(true); // Revert on failure
      }
    } catch (e: any) {
      toast.error(`Network error updating menu item: ${e?.message || e}`);
      fetchData(true);
    } finally {
      setIsSavingItem(false);
    }
  };

  // Toggle Item Availability (86 / In Stock)
  const handleToggleItemAvailability = async (item: MenuItem) => {
    const updated = { ...item, is_available: !item.is_available };
    await handleSaveMenuItem(updated);
  };

  // Create new menu item
  const handleCreateMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const apiBase = getApiBase();
    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newItemData.name,
          category_id: Number(newItemData.category_id),
          description: newItemData.description,
          price: Number(newItemData.price),
          tax_rate: 5.0,
          is_available: true,
          is_active: true,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setMenuItems((prev) => [...prev, created]);
        setIsCreatingItem(false);
        setNewItemData({ name: "", category_id: 1, description: "", price: 350 });
        showToast(`Created new item: ${created.name}`);
      } else {
        toast.error("Failed to create menu item.");
      }
    } catch {
      toast.error("Failed to create menu item.");
    }
  };

  // Category Handlers
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newCategoryData.name.trim()) return;
    const apiBase = getApiBase();
    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCategoryData.name.trim(),
          display_order: Number(newCategoryData.display_order) || 1,
          is_active: true,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setCategories((prev) => [...prev, created]);
        setIsCreatingCategory(false);
        setNewCategoryData({ name: "", display_order: 1 });
        showToast(`Category "${created.name}" created successfully!`);
        fetchMenuData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed to create category: ${err.detail || "Server error"}`);
      }
    } catch {
      showToast("Error creating category.");
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingCategory || !editCategoryData.name.trim()) return;
    const apiBase = getApiBase();
    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/categories/${editingCategory.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editCategoryData.name.trim(),
          display_order: Number(editCategoryData.display_order) || 1,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setEditingCategory(null);
        showToast(`Category "${updated.name}" updated successfully!`);
        fetchMenuData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed to update category: ${err.detail || "Server error"}`);
      }
    } catch {
      showToast("Error updating category.");
    }
  };

  const handleDeleteCategory = async (catId: number, catName: string) => {
    if (!confirm(`Are you sure you want to deactivate category "${catName}"?`)) return;
    if (!token) return;
    const apiBase = getApiBase();
    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/categories/${catId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCategories((prev) => prev.filter((c) => c.id !== catId));
        showToast(`Category "${catName}" removed.`);
        fetchMenuData();
      }
    } catch {
      showToast("Error deleting category.");
    }
  };

  const handleDeleteMenuItem = async (itemId: number) => {
    if (!confirm("Are you sure you want to delete this food item?")) return;
    if (!token) return;
    const apiBase = getApiBase();
    try {
      const res = await adminFetch(`${apiBase}/api/v1/menu/items/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMenuItems((prev) => prev.filter((i) => i.id !== itemId));
        showToast("Food item deleted successfully.");
        fetchMenuData();
      }
    } catch {
      showToast("Error deleting food item.");
    }
  };

  const handleOpenAddItemForCategory = (categoryId: number) => {
    setNewItemData((prev) => ({ ...prev, category_id: categoryId }));
    setIsCreatingItem(true);
  };

  // Generate and show Table QR
  const handleOpenTableQr = async (tableNumber: string, qrToken: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://cafe-piza.vercel.app";
    const orderUrl = `${origin}/table/${qrToken}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(orderUrl, {
        width: 380,
        margin: 2,
        color: { dark: "#2C1E16", light: "#FFFFFF" },
      });
      setQrModalTable({ number: tableNumber, url: orderUrl, qrDataUrl });
    } catch {
      toast.error("Could not generate QR code.");
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let filename = `jaadoo_report_${new Date().toISOString().slice(0, 10)}.csv`;

    if (activeTab === "ledger") {
      if (ledgerSubTab === "inventory") {
        if (!scannedBills.length) {
          toast.warning("No scanned inventory bills to export.");
          return;
        }
        filename = `jaadoo_inventory_purchase_bills_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = ["Bill ID / Invoice #", "Supplier", "Bill Date", "Items Count", "Total Amount (INR)", "Status", "Scanned At"];
        rows = scannedBills.map((b) => [
          `"${(b.bill_id || b.bill_number).replace(/"/g, '""')}"`,
          `"${(b.supplier_name || "").replace(/"/g, '""')}"`,
          b.bill_date || "-",
          b.items_count || 0,
          Number(b.total_amount || 0),
          b.status || "RECEIVED",
          b.created_at ? new Date(b.created_at).toLocaleString("en-IN") : "-",
        ]);
      } else {
        if (!customerBills.length) {
          toast.warning("No customer dining bills to export.");
          return;
        }
        filename = `jaadoo_customer_sales_bills_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = ["Bill ID", "Table", "Customer", "Subtotal (INR)", "Discount (INR)", "Tax GST (INR)", "Total Amount (INR)", "Payment Status", "Payment Method", "Date Time"];
        rows = customerBills.map((c) => [
          `"${c.bill_id.replace(/"/g, '""')}"`,
          `"${c.table_number.replace(/"/g, '""')}"`,
          `"${(c.customer_name || "Walk-in Guest").replace(/"/g, '""')}"`,
          Number(c.subtotal || 0),
          Number(c.discount_amount || 0),
          Number(c.tax_amount || 0),
          Number(c.total_amount || 0),
          c.is_paid ? "PAID" : "UNPAID",
          c.payment_method || "CASH",
          c.created_at ? new Date(c.created_at).toLocaleString("en-IN") : "-",
        ]);
      }
    } else if (salesHistory.length > 0) {
      filename = `jaadoo_sales_history_${new Date().toISOString().slice(0, 10)}.csv`;
      headers = ["Date", "Revenue (INR)", "Orders / KOTs"];
      rows = salesHistory.map((s) => [s.date, Number(s.revenue || 0), s.kots]);
    } else if (kots.length > 0) {
      filename = `jaadoo_orders_report_${new Date().toISOString().slice(0, 10)}.csv`;
      headers = ["KOT Number", "Table", "Status", "Items Count", "Total Amount (INR)", "Date Time"];
      rows = kots.map((k) => [
        k.kot_number,
        k.table_number,
        k.status,
        k.items_count,
        Number(k.total_amount || 0),
        new Date(k.created_at).toLocaleString("en-IN"),
      ]);
    } else {
      toast.warning("No records to export.");
      return;
    }

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Menu Items
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesSearch =
        !menuSearch ||
        item.name.toLowerCase().includes(menuSearch.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(menuSearch.toLowerCase()));
      const matchesCategory =
        selectedCategoryFilter === "all" || item.category_id === Number(selectedCategoryFilter);
      return matchesSearch && matchesCategory;
    });
  }, [menuItems, menuSearch, selectedCategoryFilter]);

  // Filtered Reservations
  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      const q = resSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.id.toString().includes(q) ||
        r.booking_id?.toLowerCase().includes(q) ||
        r.customer_name?.toLowerCase().includes(q) ||
        r.customer_phone?.includes(q) ||
        r.table_name?.toLowerCase().includes(q) ||
        r.floor_name?.toLowerCase().includes(q) ||
        r.upi_utr?.toLowerCase().includes(q);
      const matchesDate = !resDateFilter || r.booking_date === resDateFilter;
      const matchesFloor = resFloorFilter === "all" || r.floor_number === Number(resFloorFilter);
      return matchesSearch && matchesDate && matchesFloor;
    });
  }, [reservations, resSearch, resDateFilter, resFloorFilter]);

  const recentReservations = useMemo(() => {
    return filteredReservations.filter((r) => !r.is_historical_limited);
  }, [filteredReservations]);

  const historicalReservations = useMemo(() => {
    return filteredReservations.filter((r) => r.is_historical_limited);
  }, [filteredReservations]);

  // Filtered Tables
  const filteredTables = useMemo(() => {
    const baseList = tables.length > 0 ? tables : RESTAURANT_TABLES.map((rt) => ({
      id: rt.id,
      table_number: `Table ${rt.floor_table_num}`,
      floor_table_num: rt.floor_table_num,
      capacity: rt.capacity,
      qr_token: rt.qr_token,
      is_active: true,
      active_session_count: 0,
      floor_number: rt.floor,
      floor_name: rt.floor_name,
    }));
    return baseList.filter((t) => {
      if (tableFloorFilter === "all") return true;
      return t.floor_number === Number(tableFloorFilter);
    });
  }, [tables, tableFloorFilter]);

  // Max value for revenue bar chart
  const maxRevenue = useMemo(() => {
    if (!salesHistory.length) return 1;
    return Math.max(...salesHistory.map((s) => s.revenue), 1000);
  }, [salesHistory]);

  // Memoized Operations Metrics & Filters
  const opSalesTotal = useMemo(() => {
    return opKots.reduce((sum, k) => sum + (Number(k.total_amount) || 0), 0);
  }, [opKots]);

  const opOpenKotsCount = useMemo(() => {
    return opKots.filter((k) => k.status !== "SERVED" && k.status !== "CANCELLED").length;
  }, [opKots]);

  // Unified display data with fallback to ensure tables and bookings always show live
  const displayTableOverviews = useMemo(() => {
    if (opTableOverviews.length > 0) return opTableOverviews;
    if (tables.length > 0) {
      return tables.map((t) => {
        const fl = getTableFloor(t.id, t.floor_number);
        const relNum = t.floor_table_num || fl.floor_table_num;
        return {
          table_id: t.id,
          table_number: `Table ${relNum}`,
          floor_table_num: relNum,
          capacity: t.capacity || fl.capacity || 4,
          floor_number: t.floor_number || fl.floor,
          floor_name: t.floor_name || fl.name,
          active_session_count: t.is_occupied ? 1 : 0,
          total_sessions_today: 0,
          sessions: [],
        };
      });
    }
    return RESTAURANT_TABLES.map((rt) => ({
      table_id: rt.id,
      table_number: rt.table_number,
      floor_table_num: rt.floor_table_num,
      capacity: rt.capacity,
      floor_number: rt.floor,
      floor_name: rt.floor_name,
      active_session_count: 0,
      total_sessions_today: 0,
      sessions: [],
    }));
  }, [opTableOverviews, tables]);

  const opActiveTablesCount = useMemo(() => {
    return displayTableOverviews.filter((t) => (t.active_session_count || 0) > 0).length;
  }, [displayTableOverviews]);

  const filteredOpTables = useMemo(() => {
    let list = displayTableOverviews;
    if (opFloorFilter !== "all") {
      list = list.filter((tbl) => {
        const floorNum = tbl.floor_number || getTableFloor(tbl.table_id).floor;
        return floorNum === Number(opFloorFilter);
      });
    }
    if (opTableFilter === "active") {
      return list.filter((t) => (t.active_session_count || 0) > 0);
    }
    if (opTableFilter === "available") {
      return list.filter((t) => (t.active_session_count || 0) === 0);
    }
    return list;
  }, [displayTableOverviews, opFloorFilter, opTableFilter]);

  // ---------------------------------------------------------------------------
  // AUTH LOGIN SCREEN - WARM BEIGE ARTISANAL THEME
  // ---------------------------------------------------------------------------
  if (!token) {
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
              <p className="text-[11px] uppercase tracking-[0.25em] text-[#B85B43] font-bold mt-0.5">
                Owner Portal · Executive Management & Live Control
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#6B5A4E] block mb-1.5">
                Owner Username
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="admin"
                required
                className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl px-4 py-3 text-sm text-[#2A1E17] placeholder-[#A8988B] outline-none transition-all shadow-2xs"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#6B5A4E] block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl px-4 py-3 pr-11 text-sm text-[#2A1E17] placeholder-[#A8988B] outline-none transition-all shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6D] hover:text-[#B85B43] transition-colors p-1 cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
              {isLoggingIn ? "AUTHENTICATING..." : "ENTER OWNER DASHBOARD"}
            </button>
          </form>

          {/* Quick links footer */}
          <div className="pt-4 border-t border-[#E8DFC9] flex items-center justify-between text-xs text-[#7A6A5E]">
            <Link href="/pos" className="hover:text-[#B85B43] font-semibold transition-colors flex items-center gap-1">
              <span>Go to POS</span>
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

  // ---------------------------------------------------------------------------
  // MAIN OWNER DASHBOARD - LUXURIOUS BEIGE ARTISANAL THEME
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#F8F5EE] text-[#241A14] font-sans selection:bg-[#B85B43] selection:text-white flex flex-col">
      {/* Toast Notification for Real-Time Changes */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-[60] bg-[#2A1E17] text-[#FAF6F0] px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2 border border-[#E8AA62]/40"
          >
            <Sparkles className="w-4 h-4 text-[#E8AA62] shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header */}
      <header className="bg-[#FFFDF9] border-b border-[#E6DCce] px-4 sm:px-6 py-3.5 sticky top-0 z-40 shadow-xs grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* Left: Status Indicator */}
        <div className="hidden md:flex items-center justify-start gap-2 text-xs font-semibold text-stone-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] font-mono tracking-wider uppercase text-stone-500">EXECUTIVE SUITE</span>
        </div>

        {/* Center: Editorial Brand Logo & Jaadoo Pizza Project Title */}
        <div className="flex items-center justify-center gap-3.5 min-w-0">
          <div className="w-16 h-10 sm:w-20 sm:h-12 rounded-xl overflow-hidden border-2 border-[#9E3E26]/40 shadow-md bg-white shrink-0">
            <img
              src="/jaadoo_logo.jpg"
              alt="Jaadoo Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-center sm:text-left">
            <h1>
              <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-lg sm:text-2xl leading-tight" />
            </h1>
            <div className="mt-0.5">
              <span className="text-[10px] uppercase font-extrabold tracking-[0.22em] text-[#B85B43]">
                Owner Executive Portal
              </span>
            </div>
          </div>
        </div>

        {/* Right: Global Action Header */}
        <div className="flex w-full flex-wrap items-center justify-center md:justify-end gap-2 sm:gap-3">
          <Button
            variant="secondary"
            onClick={() => fetchData(false)}
            disabled={isLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-[#B85B43]" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Link href="/pos" target="_blank" className="inline-flex">
            <Button variant="secondary" className="text-[#B85B43] border-[#B85B43]/30">
              <Store className="w-3.5 h-3.5" />
              <span>Open POS</span>
              <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
            </Button>
          </Link>

          <Button
            variant="ghost"
            onClick={handleLogout}
            className="text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </Button>
        </div>
      </header>

      {/* Sub-Header Navigation Tabs (Shadcn Tabs UI) */}
      <div className="bg-[#F3EDE2] border-b border-[#E4DCD0] px-4 sm:px-6 py-2 overflow-x-auto">
        <TabsList className="bg-transparent border-0 p-0 gap-1.5 flex">
          {[
            { id: "analytics", label: "Executive Analytics", icon: TrendingUp },
            { id: "operations", label: "Operations", icon: SlidersHorizontal },
            { id: "menu", label: "Menu", icon: Utensils },
            { id: "inventory", label: "Inventory", icon: Package },
            { id: "reservations", label: "Reservations CRM", icon: Calendar },
            { id: "tables", label: "Table QR Codes", icon: QrCode },
            { id: "ledger", label: "Billing & Finance Ledger", icon: Receipt },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <TabsTrigger
                key={tab.id}
                active={isActive}
                onClick={() => setActiveTab(tab.id as any)}
                className="px-3.5 py-1.5 uppercase tracking-wider text-[11px]"
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {/* Main Tab Content */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full min-w-0 mx-auto space-y-6">
        {/* TAB 1: EXECUTIVE ANALYTICS */}
        {activeTab === "analytics" && (
          <div className="space-y-6">
            {/* Primary KPI Metric Cards (Symmetrical, Precision-Engineered Shadcn UI) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
              {/* Card 1: Today's / Daily Revenue */}
              <Card className="p-5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#D9CCBA] group">
                <div className="flex items-center justify-between text-xs text-[#7A6A5E] font-bold uppercase tracking-wider">
                  <span className="truncate">{revDay === todayIso ? "Today's Revenue" : "Daily Revenue"}</span>
                  <span className="w-6 h-6 rounded-md bg-[#FAF5ED] border border-[#E8DFC9] flex items-center justify-center text-[#B85B43] shrink-0">
                    <IndianRupee className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Symmetrical Control Slot (Fixed h-8) */}
                <div className="my-2.5">
                  <div className="relative h-8 w-full bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#E0D4C2] hover:border-[#B85B43] rounded-lg px-2.5 flex items-center justify-between text-[11px] font-semibold text-[#4A392F] transition-colors cursor-pointer group-focus-within:border-[#B85B43]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Calendar className="w-3.5 h-3.5 text-[#B85B43] shrink-0" />
                      <span>{revDay === todayIso ? `Today (${shortDate(revDay)})` : shortDate(revDay)}</span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#8C7A6D] shrink-0" />
                    <input
                      type="date"
                      value={revDay}
                      min={shiftDays(todayIso, -6)}
                      max={todayIso}
                      onChange={(e) => e.target.value && setRevDay(e.target.value)}
                      aria-label="Revenue date"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </div>
                </div>

                {/* Key Metric Value */}
                <div className="text-2xl sm:text-3xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{Number(revFigures.day?.revenue || 0).toLocaleString("en-IN")}
                </div>
              </Card>

              {/* Card 2: Weekly Revenue */}
              <Card className="p-5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#D9CCBA] group">
                <div className="flex items-center justify-between text-xs text-[#7A6A5E] font-bold uppercase tracking-wider">
                  <span className="truncate">Weekly Revenue</span>
                  <span className="w-6 h-6 rounded-md bg-[#FAF5ED] border border-[#E8DFC9] flex items-center justify-center text-emerald-700 shrink-0">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Symmetrical Control Slot (Fixed h-8) */}
                <div className="my-2.5">
                  <div className="relative h-8 w-full bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#E0D4C2] hover:border-[#B85B43] rounded-lg px-2.5 flex items-center justify-between text-[11px] font-semibold text-[#4A392F] transition-colors cursor-pointer group-focus-within:border-[#B85B43]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Clock className="w-3.5 h-3.5 text-[#B85B43] shrink-0" />
                      <span>{revWeekEnd === todayIso ? "Last 7 Days" : `${shortDate(shiftDays(revWeekEnd, -6))} – ${shortDate(revWeekEnd)}`}</span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#8C7A6D] shrink-0" />
                    <select
                      value={revWeekEnd}
                      onChange={(e) => setRevWeekEnd(e.target.value)}
                      aria-label="Revenue week"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    >
                      {Array.from({ length: 12 }, (_, i) => shiftDays(todayIso, -7 * i)).map((weekEnd, i) => (
                        <option key={weekEnd} value={weekEnd}>
                          {i === 0 ? "Last 7 days" : `${shortDate(shiftDays(weekEnd, -6))} – ${shortDate(weekEnd)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Key Metric Value */}
                <div className="text-2xl sm:text-3xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{Number(revFigures.week?.revenue || 0).toLocaleString("en-IN")}
                </div>
              </Card>

              {/* Card 3: Monthly Revenue */}
              <Card className="p-5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#D9CCBA] group">
                <div className="flex items-center justify-between text-xs text-[#7A6A5E] font-bold uppercase tracking-wider">
                  <span className="truncate">Monthly Revenue</span>
                  <span className="w-6 h-6 rounded-md bg-[#FAF5ED] border border-[#E8DFC9] flex items-center justify-center text-[#B85B43] shrink-0">
                    <Calendar className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Symmetrical Control Slot (Fixed h-8) */}
                <div className="my-2.5">
                  <div className="relative h-8 w-full bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#E0D4C2] hover:border-[#B85B43] rounded-lg px-2.5 flex items-center justify-between text-[11px] font-semibold text-[#4A392F] transition-colors cursor-pointer group-focus-within:border-[#B85B43]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Calendar className="w-3.5 h-3.5 text-[#B85B43] shrink-0" />
                      <span>{(() => {
                        const [y, m] = revMonth.split("-").map(Number);
                        return new Date(y, m - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
                      })()}</span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#8C7A6D] shrink-0" />
                    <select
                      value={revMonth}
                      onChange={(e) => setRevMonth(e.target.value)}
                      aria-label="Revenue month"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    >
                      {Array.from({ length: 24 }, (_, i) => {
                        const [y, m] = todayIso.split("-").map(Number);
                        const d = new Date(y, m - 1 - i, 1);
                        return { value: isoDate(d).slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
                      }).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Key Metric Value */}
                <div className="text-2xl sm:text-3xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{Number(revFigures.month?.revenue || 0).toLocaleString("en-IN")}
                </div>
              </Card>

              {/* Card 4: Yearly Revenue */}
              <Card className="p-5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#D9CCBA] group">
                <div className="flex items-center justify-between text-xs text-[#7A6A5E] font-bold uppercase tracking-wider">
                  <span className="truncate">Yearly Revenue</span>
                  <span className="w-6 h-6 rounded-md bg-[#FAF5ED] border border-[#E8DFC9] flex items-center justify-center text-[#B85B43] shrink-0">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Symmetrical Control Slot (Fixed h-8) */}
                <div className="my-2.5">
                  <div className="relative h-8 w-full bg-[#FAF6EE] hover:bg-[#F3EDE2] border border-[#E0D4C2] hover:border-[#B85B43] rounded-lg px-2.5 flex items-center justify-between text-[11px] font-semibold text-[#4A392F] transition-colors cursor-pointer group-focus-within:border-[#B85B43]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Calendar className="w-3.5 h-3.5 text-[#B85B43] shrink-0" />
                      <span>Calendar Year {revYear}</span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#8C7A6D] shrink-0" />
                    <select
                      value={revYear}
                      onChange={(e) => setRevYear(e.target.value)}
                      aria-label="Revenue year"
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    >
                      {Array.from({ length: 5 }, (_, i) => String(Number(todayIso.slice(0, 4)) - i)).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Key Metric Value */}
                <div className="text-2xl sm:text-3xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{Number(revFigures.year?.revenue || 0).toLocaleString("en-IN")}
                </div>
              </Card>

              {/* Card 5: All-Time Sales (Symmetrically Balanced) */}
              <Card className="p-5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#D9CCBA] group">
                <div className="flex items-center justify-between text-xs text-[#7A6A5E] font-bold uppercase tracking-wider">
                  <span className="truncate">All-Time Sales</span>
                  <span className="w-6 h-6 rounded-md bg-[#FAF5ED] border border-[#E8DFC9] flex items-center justify-center text-amber-600 shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </span>
                </div>

                {/* Symmetrical Control Slot (Fixed h-8 matching cards 1-4) */}
                <div className="my-2.5">
                  <div className="h-8 w-full bg-[#FAF6EE] border border-[#E0D4C2] rounded-lg px-2.5 flex items-center justify-between text-[11px] font-semibold text-[#7A6A5E]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Full Restaurant Record</span>
                    </span>
                    <span className="text-[10px] text-[#A8988B] font-mono uppercase">Lifetime</span>
                  </div>
                </div>

                {/* Key Metric Value */}
                <div className="text-2xl sm:text-3xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{Number(metrics?.total_revenue || 0).toLocaleString("en-IN")}
                </div>
              </Card>
            </div>



            {/* 14-Day Sales Trend Bar Chart (Shadcn UI & Recharts Pattern) */}
            <div className="bg-[#FFFDF9] border border-[#E6DCCF] rounded-2xl p-6 shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-serif font-bold uppercase tracking-wider text-[#241A14]">
                      Daily Sales History (Last 14 Days)
                    </h3>

                  </div>
                  <p className="text-xs text-[#7A6A5E] mt-0.5">
                    Day-by-day revenue progression and customer ticket counts. Hover on any bar for precise figures.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="bg-[#F3EDE2] text-[#B85B43] px-3 py-1 rounded-lg text-xs font-bold border border-[#E6DCCF]">
                    Revenue (₹)
                  </span>
                </div>
              </div>

              {/* Shadcn-Style Summary KPI Badges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="bg-[#FAF7F0] p-3 rounded-xl border border-[#E6DCCF] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#7A6A5E] block">
                      14-Day Cumulative
                    </span>
                    <span className="text-base font-extrabold text-[#241A14]">
                      ₹{chartStats.totalRev.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#B85B43] bg-white px-2 py-1 rounded-lg border border-[#E6DCCF]">
                    {chartStats.totalOrders} KOTs
                  </span>
                </div>

                <div className="bg-[#FAF7F0] p-3 rounded-xl border border-[#E6DCCF] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#7A6A5E] block">
                      Daily Average
                    </span>
                    <span className="text-base font-extrabold text-[#241A14]">
                      ₹{chartStats.avgDailyRev.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#7A6A5E] font-medium">per day</span>
                </div>

                <div className="bg-[#FAF7F0] p-3 rounded-xl border border-[#E6DCCF] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#7A6A5E] block">
                      Highest Single Day
                    </span>
                    <span className="text-base font-extrabold text-emerald-700">
                      ₹{Number(chartStats.peakDay?.revenue || 0).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                    {chartStats.peakDay?.date || "—"}
                  </span>
                </div>
              </div>

              {/* Interactive Recharts Graph */}
              <div className="w-full h-64 sm:h-72 pt-2">
                {isChartMounted && salesHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={salesHistory}
                      margin={{ top: 12, right: 12, left: -10, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EBE2D4" />
                      <XAxis
                        dataKey="date"
                        stroke="#8C7A6D"
                        fontSize={11}
                        tickLine={false}
                        axisLine={{ stroke: "#E6DCCF" }}
                        dy={6}
                      />
                      <YAxis
                        stroke="#8C7A6D"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) =>
                          chartMetric === "revenue"
                            ? val >= 1000
                              ? `₹${(val / 1000).toFixed(0)}k`
                              : `₹${val}`
                            : `${val}`
                        }
                        dx={-4}
                      />
                      <RechartsTooltip
                        cursor={{ fill: "#F5EFE6", opacity: 0.7 }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const rev = Number(data.revenue || 0);
                            const kots = Number(data.kots || 0);
                            const avgTicket = kots > 0 ? Math.round(rev / kots) : 0;
                            return (
                              <div className="bg-[#241A14] text-white p-3.5 rounded-2xl border border-[#B85B43]/60 shadow-2xl space-y-2 min-w-[200px] backdrop-blur-md">
                                <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                  <span className="text-xs font-mono font-bold text-[#FAF6EE]">{data.date}</span>
                                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-[#B85B43]/30 text-[#F5B099] border border-[#B85B43]/40">
                                    {kots} {kots === 1 ? "order" : "orders"}
                                  </span>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-[10px] uppercase tracking-wider text-[#A8988B] font-semibold">
                                    {chartMetric === "revenue" ? "Daily Revenue" : "Order Volume"}
                                  </div>
                                  <div className="text-2xl font-bold font-mono text-[#4ADE80]">
                                    ₹{rev.toLocaleString("en-IN")}
                                  </div>
                                </div>
                                <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] text-[#C4B5A5]">
                                  <span>Avg Ticket:</span>
                                  <span className="font-mono font-bold text-white">
                                    {kots > 0 ? `₹${avgTicket.toLocaleString("en-IN")}` : "—"}
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar
                        dataKey={chartMetric === "revenue" ? "revenue" : "kots"}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={36}
                      >
                        {salesHistory.map((entry, index) => {
                          const isPeak = entry.date === chartStats.peakDay?.date && (chartStats.peakDay?.revenue ?? 0) > 0;
                          return (
                            <Cell
                              key={`cell-${index}`}
                              fill={
                                isPeak
                                  ? "#B85B43" // Terracotta highlight on peak day
                                  : chartMetric === "revenue"
                                    ? entry.revenue > 0
                                      ? "#16A34A" // Vibrant emerald on active revenue days
                                      : "#D4C7B8" // Subtle placeholder on zero days
                                    : entry.kots > 0
                                      ? "#2563EB"
                                      : "#D4C7B8"
                              }
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-[#8C7A6D] bg-[#FAF7F0] rounded-xl border border-dashed border-[#E6DCCF]">
                    Loading sales trend analytics...
                  </div>
                )}
              </div>
            </div>

            {/* Two-Column Grid: Payment Breakdown & Top Selling Items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Methods */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[#B85B43]" />
                    <span>Payment Method Distribution</span>
                  </CardTitle>
                  <CardDescription>
                    Settled payments across customer payment channels
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#FAF6EE] p-4 rounded-xl border border-[#E6DCCF] text-center space-y-1">
                      <Smartphone className="w-5 h-5 text-indigo-600 mx-auto" />
                      <div className="text-xs uppercase font-bold text-[#7A6A5E]">UPI Payments</div>
                      <div className="text-lg font-extrabold text-[#241A14]">
                        ₹{Number(paymentBreakdown.UPI || 0).toLocaleString("en-IN")}
                      </div>
                    </div>

                    <div className="bg-[#FAF6EE] p-4 rounded-xl border border-[#E6DCCF] text-center space-y-1">
                      <Banknote className="w-5 h-5 text-emerald-600 mx-auto" />
                      <div className="text-xs uppercase font-bold text-[#7A6A5E]">Cash Register</div>
                      <div className="text-lg font-extrabold text-[#241A14]">
                        ₹{Number(paymentBreakdown.CASH || 0).toLocaleString("en-IN")}
                      </div>
                    </div>

                    <div className="bg-[#FAF6EE] p-4 rounded-xl border border-[#E6DCCF] text-center space-y-1">
                      <CreditCard className="w-5 h-5 text-amber-600 mx-auto" />
                      <div className="text-xs uppercase font-bold text-[#7A6A5E]">Card Terminal</div>
                      <div className="text-lg font-extrabold text-[#241A14]">
                        ₹{Number(paymentBreakdown.CARD || 0).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Top Selling Menu Items */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Utensils className="w-4 h-4 text-[#B85B43]" />
                    <span>Top Performing Menu Items</span>
                  </CardTitle>
                  <CardDescription>
                    Highest grossing culinary items ordered in the restaurant
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                    {topItems.length > 0 ? (
                      topItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="bg-[#FAF6EE] p-3 rounded-xl border border-[#E6DCCF] flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            <Badge variant="default" className="w-5 h-5 p-0 justify-center text-[10px]">
                              {idx + 1}
                            </Badge>
                            <div>
                              <span className="font-bold text-[#241A14]">{item.name}</span>
                              <span className="text-[10px] text-[#7A6A5E] block">{item.quantity} units ordered</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-extrabold text-[#241A14]">₹{item.revenue.toLocaleString("en-IN")}</span>
                            <span className="text-[10px] text-[#7A6A5E] block">₹{item.price} each</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-[#8C7A6D] text-center py-6">
                        No order items recorded yet for product performance ranking.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: OPERATIONS COMMAND & DATE CONTROLLER (REAL-TIME & HISTORICAL ARCHIVE) */}
        {/* ========================================================================= */}
        {activeTab === "operations" && (
          <div className="space-y-6">
            {/* 1. Header & Operational Date Controller Bar */}
            <Card className="p-5 shadow-xs space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-[#B85B43]/10 text-[#B85B43]">
                      <SlidersHorizontal className="w-5 h-5" />
                    </span>
                    <h2 className="text-lg font-sans font-bold text-[#241A14]">Operations Command Center</h2>
                  </div>
                  <p className="text-xs text-[#7A6A5E] mt-1">
                    Check tables booked on any date, verify live & historical sales, monitor open KOTs, and audit dough capacity.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => fetchOperationsData(opDate)}
                    disabled={isOpLoading}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[#B85B43] ${isOpLoading ? "animate-spin" : ""}`} />
                    <span>{isOpLoading ? "Syncing..." : "Refresh Data"}</span>
                  </Button>
                </div>
              </div>

              {/* Operational Date Controller */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#FAF7F0] p-3.5 rounded-xl border border-[#E4DCD0] text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-sans font-bold uppercase text-[#4A392F] tracking-wider text-[11px] flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#B85B43]" />
                    OPERATIONS DATE:
                  </span>

                  <div className="flex items-center gap-1.5 bg-[#FFFDF9] px-3 py-1 rounded-lg border border-[#E4DCD0] shadow-xs">
                    <input
                      type="date"
                      value={opDate}
                      onChange={(e) => setOpDate(e.target.value)}
                      className="bg-transparent font-mono font-bold text-xs text-[#241A14] focus:outline-none cursor-pointer"
                    />
                  </div>

                  {/* Quick Switchers */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant={isOpToday ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setOpDate(getLocalDateString(0))}
                      className="text-[11px] h-7 px-2.5"
                    >
                      Today
                    </Button>
                    <Button
                      variant={opDate === getLocalDateString(-1) ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setOpDate(getLocalDateString(-1))}
                      className="text-[11px] h-7 px-2.5"
                    >
                      Yesterday
                    </Button>
                    <Button
                      variant={opDate === getLocalDateString(-2) ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setOpDate(getLocalDateString(-2))}
                      className="text-[11px] h-7 px-2.5"
                    >
                      2 Days Ago
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={isOpToday ? "success" : isOpFuture ? "secondary" : "default"}>
                    {isOpToday ? "Live Shift" : isOpFuture ? "Future Booking" : "History Archive"}
                  </Badge>

                  {!isOpToday && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpDate(getLocalDateString(0))}
                      className="text-[11px] text-[#B85B43] h-7 px-2"
                    >
                      <RotateCw className="w-3 h-3 mr-1" />
                      <span>Return to Today</span>
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* 2. Top Summary KPI Cards for Selected Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Active Tables */}
              <Card className="p-4 shadow-xs">
                <div className="text-[11px] uppercase tracking-wider font-bold text-[#7A6A5E] flex items-center justify-between">
                  <span>ACTIVE TABLES</span>
                  <Users className="w-4 h-4 text-[#8C7A6D]" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] mt-2 flex items-baseline gap-2">
                  <span>{opActiveTablesCount}</span>
                  <span className="text-xs font-normal text-[#8C7A6D] font-sans">
                    / {displayTableOverviews.length} total
                  </span>
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  {isOpToday ? "Currently seated dining sessions" : "Sessions active on this date"}
                </p>
              </Card>

              {/* Card 2: Open / Total KOTs */}
              <Card className="p-4 shadow-xs">
                <div className="text-[11px] uppercase tracking-wider font-bold text-[#7A6A5E] flex items-center justify-between">
                  <span>OPEN KOTS</span>
                  <Receipt className="w-4 h-4 text-[#8C7A6D]" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] mt-2 flex items-baseline gap-2">
                  <span>{opOpenKotsCount}</span>
                  <span className="text-xs font-normal text-[#8C7A6D] font-sans">
                    ({opKots.length} total tickets)
                  </span>
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  Kitchen tickets placed for this date
                </p>
              </Card>

              {/* Card 3: Operations Sales */}
              <Card className="p-4 shadow-xs">
                <div className="text-[11px] uppercase tracking-wider font-bold text-[#7A6A5E] flex items-center justify-between">
                  <span>OPERATIONS SALES</span>
                  <TrendingUp className="w-4 h-4 text-[#4A5842]" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] mt-2">
                  ₹{Number(opSalesTotal || 0).toLocaleString("en-IN")}
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  {opSummary?.order_count || opKots.length} orders recorded
                </p>
              </Card>

              {/* Card 4: Daily Dough & Protected Capacity */}
              <Card className="p-4 shadow-xs">
                <div className="text-[11px] uppercase tracking-wider font-bold text-[#7A6A5E] flex items-center justify-between">
                  <span>DOUGH CAPACITY</span>
                  <Flame className="w-4 h-4 text-[#B85B43]" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] mt-2 flex items-baseline gap-2">
                  <span>{opDough?.walk_in_available ?? "—"}</span>
                  <span className="text-xs font-normal text-[#8C7A6D] font-sans">
                    walk-in units
                  </span>
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  {opDough?.total_active_protected ?? opDough?.protected_units ?? 0} units reserved for bookings
                </p>
              </Card>
            </div>

            {/* 3. Operations Sub-Tabs */}
            <TabsList>
              <TabsTrigger
                active={opSubTab === "kots"}
                onClick={() => setOpSubTab("kots")}
                className="text-xs font-bold"
              >
                KOT Orders ({opKots.length})
              </TabsTrigger>
            </TabsList>

            {/* SUB-VIEW 3: KOT ORDERS ON SELECTED DATE */}
            {opSubTab === "kots" && (
              <div className="space-y-4">
                <Card className="overflow-hidden shadow-xs">
                  <div className="p-4 border-b border-[#E6DCCF] flex items-center justify-between bg-[#F3EDE2]/60">
                    <h3 className="text-sm font-sans font-bold text-[#241A14]">
                      KOT Kitchen Tickets on <span className="font-mono">{opDate}</span>
                    </h3>
                    <Badge variant="default" className="text-xs font-bold">
                      Total Sales: ₹{Number(opSalesTotal || 0).toLocaleString("en-IN")}
                    </Badge>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>KOT Ticket</TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead>Order / Time</TableHead>
                        <TableHead>Items Summary</TableHead>
                        <TableHead>Total Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {opKots.length > 0 ? (
                        opKots.map((k: any) => (
                          <TableRow key={k.id}>
                            <TableCell className="font-mono font-bold text-[#B85B43]">
                              {k.kot_number || `#KOT-${k.id}`}
                            </TableCell>
                            <TableCell className="font-bold text-[#241A14]">
                              {(() => {
                                const kFl = getTableFloor(k.table_id || k.table_number);
                                return `Table #${kFl.floor_table_num} (${kFl.short})`;
                              })()}
                            </TableCell>
                            <TableCell className="text-[#665448]">
                              {k.created_at
                                ? new Date(k.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {k.items && k.items.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {k.items.map((it: any, idx: number) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-0.5 rounded bg-[#FAF7F0] border border-[#E0D4C2] text-[10px] text-[#241A14]"
                                    >
                                      {it.quantity}x {it.name}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[#8C7A6D]">{k.items_count || 0} items</span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-bold text-[#241A14]">
                              ₹{Number(k.total_amount || 0).toLocaleString("en-IN")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  k.status === "SERVED"
                                    ? "success"
                                    : k.status === "READY"
                                      ? "secondary"
                                      : "warning"
                                }
                              >
                                {k.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="p-8 text-center text-[#8C7A6D]">
                            No KOT kitchen tickets placed on {opDate}.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: INVENTORY & FOOD CATEGORIES MANAGEMENT */}
        {activeTab === "menu" && (
          <div className="space-y-6">
            {/* 1. Header with Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-sans font-bold text-[#241A14]">
                    Menu & Categories
                  </h2>
                  <Badge variant="default" className="text-[10px]">
                    {categories.length} Categories • {menuItems.length} Food Items
                  </Badge>
                </div>
                <p className="text-xs text-[#7A6A5E] mt-1">
                  Manage food categories, add items to any category, and edit names, descriptions, prices and stock status across POS and customer digital ordering.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNewCategoryData({ name: "", display_order: categories.length + 1 });
                    setIsCreatingCategory(true);
                  }}
                >
                  <FolderPlus className="w-4 h-4 text-[#B85B43]" />
                  <span>+ New Category</span>
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    setNewItemData({
                      name: "",
                      category_id: selectedCategoryFilter === "all" ? (categories[0]?.id || 1) : Number(selectedCategoryFilter),
                      description: "",
                      price: 350,
                    });
                    setIsCreatingItem(true);
                  }}
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Add Food Item</span>
                </Button>
              </div>
            </div>

            {/* 2. CATEGORIES SECTION (CARDS HUB) */}
            <Card className="p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#F0E8DC] pb-3">
                <div>
                  <h3 className="font-sans font-bold text-sm text-[#241A14] flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#B85B43]" />
                    Food Item Category Sections
                  </h3>
                  <p className="text-[11px] text-[#7A6A5E]">
                    Select any category below to filter items, add food items directly to it, or edit the category name.
                  </p>
                </div>
                <div className="text-xs font-bold text-[#8C7A6D]">
                  {categories.length} Total Categories
                </div>
              </div>

              {/* Grid of Category Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {categories.map((c, idx) => {
                  const catItems = menuItems.filter((i) => i.category_id === c.id);
                  const inStock = catItems.filter((i) => i.is_available).length;
                  const isSelected = selectedCategoryFilter === c.id;

                  return (
                    <Card
                      key={c.id}
                      className={`p-4 flex flex-col justify-between transition-all ${isSelected
                          ? "bg-[#FAF5ED] border-[#B85B43] shadow-sm ring-1 ring-[#B85B43]"
                          : "hover:border-[#CDBFA8]"
                        }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-1">
                          <div>
                            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#B85B43]">
                              Category #{c.display_order || idx + 1}
                            </span>
                            <h4 className="font-sans font-extrabold text-sm text-[#241A14] mt-0.5 leading-snug">
                              {c.name}
                            </h4>
                          </div>
                          <Badge variant="default" className="text-[10px]">
                            {catItems.length} {catItems.length === 1 ? "Item" : "Items"}
                          </Badge>
                        </div>

                        <div className="text-[11px] text-[#7A6A5E] flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                          <span>{inStock} Available in Stock</span>
                        </div>
                      </div>

                      {/* Category Action Buttons */}
                      <div className="pt-3 mt-3 border-t border-[#F0E8DC] flex items-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleOpenAddItemForCategory(c.id)}
                          className="flex-1 text-[11px] h-7 px-2"
                          title={`Add a new food item into ${c.name}`}
                        >
                          + Add Item
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingCategory(c);
                            setEditCategoryData({ name: c.name, display_order: c.display_order || idx + 1 });
                          }}
                          className="text-[11px] h-7 px-2.5"
                          title="Edit Category Name & Order"
                        >
                          <Edit3 className="w-3 h-3 text-[#B85B43] mr-1" />
                          <span>Edit</span>
                        </Button>
                        <Button
                          variant={isSelected ? "default" : "secondary"}
                          size="sm"
                          onClick={() => setSelectedCategoryFilter(isSelected ? "all" : c.id)}
                          className="text-[11px] h-7 px-2.5"
                          title="Filter table below to this category"
                        >
                          {isSelected ? "Active" : "View"}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </Card>

            {/* 3. Filter & Search Bar */}
            <Card className="p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-[240px]">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6D]" />
                <Input
                  type="text"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  placeholder="Search food item name, price, or ingredients..."
                  className="pl-10"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                <Button
                  variant={selectedCategoryFilter === "all" ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setSelectedCategoryFilter("all")}
                  className="text-xs h-8"
                >
                  All Categories ({menuItems.length})
                </Button>
                {categories.map((c) => {
                  const count = menuItems.filter((i) => i.category_id === c.id).length;
                  const isSelected = selectedCategoryFilter === c.id;
                  return (
                    <Button
                      key={c.id}
                      variant={isSelected ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setSelectedCategoryFilter(c.id)}
                      className="text-xs h-8 flex items-center gap-1.5"
                    >
                      <span>{c.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-[#EAE0D2] text-[#665448]"
                        }`}>
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </Card>

            {/* Selected Category Notice Bar */}
            {selectedCategoryFilter !== "all" && (
              <div className="flex items-center justify-between p-3.5 bg-[#FAF5ED] rounded-xl border border-[#E0D4C2] text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#241A14]">Filtered Category:</span>
                  <Badge variant="solid">
                    {categories.find((c) => c.id === selectedCategoryFilter)?.name || "Selected"}
                  </Badge>
                  <span className="text-[#7A6A5E]">
                    ({filteredMenuItems.length} items shown)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenAddItemForCategory(Number(selectedCategoryFilter))}
                  className="text-[#B85B43] hover:text-[#A34B34] text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  <span>Add Item to this Category</span>
                </Button>
              </div>
            )}

            {/* Food Items Table */}
            <Card className="overflow-hidden shadow-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Food Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Price (₹)</TableHead>
                    <TableHead>Live Stock Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMenuItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-[#8C7A6D]">
                        <Utensils className="w-8 h-8 mx-auto mb-2 opacity-40 text-[#B85B43]" />
                        <p className="font-semibold text-sm text-[#4A392F]">No food items matching your filter</p>
                        <p className="text-[11px] text-[#A8988B] mt-1">
                          Use &quot;+ Add Food Item&quot; to add a new dish to this category.
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMenuItems.map((item) => {
                      const category = categories.find((c) => c.id === item.category_id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-bold text-[#241A14]">{item.name}</TableCell>
                          <TableCell>
                            <Badge variant="default">
                              {category?.name || "General"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[#665448] max-w-xs truncate">{item.description || "—"}</TableCell>
                          <TableCell className="font-extrabold text-[#B85B43] text-sm">₹{item.price}</TableCell>
                          <TableCell>
                            <Button
                              variant={item.is_available ? "success" : "destructive"}
                              size="sm"
                              onClick={() => handleToggleItemAvailability(item)}
                              className="text-[10px] h-7 px-2.5 rounded-full"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${item.is_available ? "bg-emerald-600" : "bg-rose-600"
                                  }`}
                              />
                              <span>{item.is_available ? "In Stock (Available)" : "86'd (Sold Out)"}</span>
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setPhotoError("");
                                  setEditingItem(item);
                                }}
                                className="text-xs h-7 px-2.5"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#B85B43] mr-1" />
                                <span>Edit Item</span>
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteMenuItem(item.id)}
                                className="h-7 w-7 p-0"
                                title="Delete Food Item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* TAB: RAW MATERIAL INVENTORY */}
        {activeTab === "inventory" && (() => {
          const qtyFmt = (v: string | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });
          const isLow = (r: RawMaterial) => Number(r.current_stock) <= Number(r.reorder_threshold);
          const lowCount = rawItems.filter(isLow).length;
          const q = rawSearch.trim().toLowerCase();
          const shown = rawItems.filter(
            (r) => (!rawLowOnly || isLow(r)) && (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
          );
          return (
            <div className="space-y-6 font-sans">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-sans font-bold text-stone-950 tracking-tight">Raw Material Inventory</h2>
                    <Badge variant="default" className="text-xs font-semibold px-2.5 py-0.5 bg-stone-900 text-stone-50">
                      {rawItems.length} Materials • {lowCount} Low Stock
                    </Badge>
                  </div>
                  <p className="text-sm font-sans text-stone-600 mt-1 font-medium">
                    Track kitchen and bar raw materials. Record purchases, wastage and stock counts to keep levels accurate.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setBillScan({ stage: "pick", supplier: "", billNumber: "", billDate: "", grandTotal: null, lines: [] })}
                    className="font-sans font-semibold text-xs h-9 px-3.5"
                  >
                    <ScanLine className="w-4 h-4 text-[#B85B43] mr-1.5" />
                    <span>Scan Bill</span>
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => setNewRaw({ name: "", sku: "", unit: "kg", stock: "", reorder: "" })}
                    className="font-sans font-semibold text-xs h-9 px-3.5"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    <span>Add Raw Material</span>
                  </Button>
                </div>
              </div>

              <Card className="p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500" />
                  <Input
                    type="text"
                    value={rawSearch}
                    onChange={(e) => setRawSearch(e.target.value)}
                    placeholder="Search material name or SKU..."
                    aria-label="Search raw materials"
                    className="pl-10 text-sm font-sans font-medium text-stone-900 placeholder:text-stone-400"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {([false, true] as const).map((low) => (
                    <Button
                      key={String(low)}
                      variant={rawLowOnly === low ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setRawLowOnly(low)}
                      className="text-xs font-sans font-semibold h-9 px-3.5"
                    >
                      {low ? `Low Stock (${lowCount})` : `All (${rawItems.length})`}
                    </Button>
                  ))}
                </div>
              </Card>

              <Card className="overflow-hidden shadow-xs border border-stone-200">
                <Table>
                  <TableHeader className="bg-stone-100/90 border-b border-stone-200">
                    <TableRow>
                      <TableHead className="font-sans font-bold text-xs uppercase tracking-wider text-stone-900 py-3.5">Material</TableHead>
                      <TableHead className="font-sans font-bold text-xs uppercase tracking-wider text-stone-900 py-3.5">In Stock</TableHead>
                      <TableHead className="font-sans font-bold text-xs uppercase tracking-wider text-stone-900 py-3.5">Reorder At</TableHead>
                      <TableHead className="font-sans font-bold text-xs uppercase tracking-wider text-stone-900 py-3.5">Status</TableHead>
                      <TableHead className="font-sans font-bold text-xs uppercase tracking-wider text-stone-900 py-3.5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-12 text-stone-500">
                          <Package className="w-9 h-9 mx-auto mb-2 opacity-50 text-[#B85B43]" />
                          <p className="font-sans font-bold text-base text-stone-800">No raw materials found</p>
                          <p className="font-sans text-xs text-stone-500 mt-1">Try adjusting your search query or filter.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      shown.map((r) => {
                        const stock = Number(r.current_stock);
                        const status = stock <= 0 ? "Out of Stock" : isLow(r) ? "Low Stock" : "In Stock";
                        return (
                          <TableRow key={r.id} className="hover:bg-amber-50/40 transition-colors">
                            <TableCell className="py-3.5">
                              <div className="font-sans font-bold text-stone-950 text-sm tracking-tight">{r.name}</div>
                              <div className="text-xs font-mono font-medium text-stone-600 tracking-wider mt-0.5">{r.sku}</div>
                            </TableCell>
                            <TableCell className="py-3.5 font-sans font-extrabold text-stone-950 text-base">
                              {qtyFmt(r.current_stock)} <span className="text-xs font-semibold text-stone-600 font-sans">{r.unit_of_measure}</span>
                            </TableCell>
                            <TableCell className="py-3.5 font-sans font-semibold text-stone-800 text-sm">
                              {qtyFmt(r.reorder_threshold)} <span className="text-xs text-stone-500 font-medium font-sans">{r.unit_of_measure}</span>
                            </TableCell>
                            <TableCell className="py-3.5">
                              <Badge
                                variant={
                                  status === "In Stock"
                                    ? "success"
                                    : status === "Low Stock"
                                      ? "warning"
                                      : "destructive"
                                }
                                className="font-sans font-bold text-xs px-2.5 py-0.5 tracking-wide"
                              >
                                {status}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-3.5 text-right">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setStockUpdate({ item: r, mode: "PURCHASE", qty: "", ref: "" })}
                                className="font-sans font-semibold text-xs h-8 px-3 text-stone-900 border-stone-300 hover:bg-stone-100"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-[#B85B43] mr-1.5" />
                                <span>Update Stock</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          );
        })()}

        {/* Update Stock Modal */}
        {stockUpdate && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFDF9] border border-[#E4DCD0] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 font-sans text-sm">
              <div className="flex items-start justify-between border-b border-[#F0E8DC] pb-3">
                <div>
                  <h3 className="text-lg font-sans font-extrabold text-stone-950">Update Stock: {stockUpdate.item.name}</h3>
                  <p className="text-stone-600 font-medium text-xs mt-0.5">
                    Current: <span className="font-bold text-stone-900">{Number(stockUpdate.item.current_stock).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</span> {stockUpdate.item.unit_of_measure}
                  </p>
                </div>
                <button type="button" onClick={() => setStockUpdate(null)} aria-label="Close" className="p-1 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-[#F3EDE2] cursor-pointer">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ["PURCHASE", "Add (Purchase)"],
                  ["WASTE", "Remove (Waste)"],
                  ["COUNT", "Set Count"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setStockUpdate({ ...stockUpdate, mode })}
                    className={`py-2 px-1 rounded-xl font-bold text-xs cursor-pointer border transition-all ${stockUpdate.mode === mode ? "bg-[#261C18] text-white border-[#261C18]" : "bg-[#FAF7F0] text-stone-700 border-[#E0D4C2] hover:bg-stone-100"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="block space-y-1.5">
                <span className="font-bold text-stone-800 text-xs">
                  {stockUpdate.mode === "COUNT" ? "Actual quantity on hand" : "Quantity"} ({stockUpdate.item.unit_of_measure})
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  autoFocus
                  value={stockUpdate.qty}
                  onChange={(e) => setStockUpdate({ ...stockUpdate, qty: e.target.value })}
                  className="w-full bg-white border border-stone-300 focus:border-[#B85B43] rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-950 outline-none"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="font-bold text-stone-800 text-xs">Reference / note (optional)</span>
                <input
                  type="text"
                  value={stockUpdate.ref}
                  onChange={(e) => setStockUpdate({ ...stockUpdate, ref: e.target.value })}
                  placeholder="e.g. supplier invoice no."
                  maxLength={100}
                  className="w-full bg-white border border-stone-300 focus:border-[#B85B43] rounded-xl px-3 py-2.5 text-sm font-medium text-stone-900 placeholder:text-stone-400 outline-none"
                />
              </label>

              <div className="pt-2 border-t border-[#F0E8DC] flex justify-end gap-2.5">
                <button type="button" onClick={() => setStockUpdate(null)} className="px-4 py-2 rounded-xl bg-[#FAF7F0] border border-stone-300 text-stone-700 font-bold text-xs cursor-pointer hover:bg-stone-100">
                  Cancel
                </button>
                <button type="button" onClick={handleStockUpdate} className="px-5 py-2 rounded-xl bg-[#B85B43] hover:bg-[#9E3E26] text-white font-bold text-xs cursor-pointer transition-colors shadow-xs">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scan Supplier Bill Modal */}
        {billScan && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFDF9] border border-[#E4DCD0] rounded-3xl p-6 max-w-3xl w-full shadow-2xl space-y-4 font-sans text-sm max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-[#F0E8DC] pb-3">
                <div>
                  <h3 className="text-lg font-sans font-extrabold text-stone-950">Scan Supplier Bill</h3>
                  <p className="text-stone-600 font-medium text-xs mt-0.5">
                    {billScan.stage === "review" || billScan.stage === "saving"
                      ? "Check every line before adding to stock. Nothing is saved until you confirm."
                      : "Take a clear photo of the bill, or upload a JPG, PNG or PDF (max 10 MB)."}
                  </p>
                </div>
                <button type="button" onClick={() => setBillScan(null)} aria-label="Close" disabled={billScan.stage === "scanning" || billScan.stage === "saving"} className="p-1 rounded-lg text-stone-500 hover:text-stone-950 hover:bg-[#F3EDE2] cursor-pointer disabled:opacity-40">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {billScan.error && <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold text-xs">{billScan.error}</p>}

              {billScan.stage === "pick" && (
                <label className="flex flex-col items-center justify-center gap-2 py-10 rounded-2xl border-2 border-dashed border-stone-300 bg-[#FAF7F0] cursor-pointer hover:border-[#B85B43] transition-colors">
                  <ScanLine className="w-8 h-8 text-[#B85B43]" />
                  <span className="font-bold text-stone-900 text-sm">Take photo or choose file</span>
                  <span className="text-stone-500 text-xs font-medium">JPG, PNG or PDF</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    capture="environment"
                    className="sr-only"
                    aria-label="Bill photo or PDF"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleScanBill(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}

              {billScan.stage === "scanning" && (
                <div className="py-12 text-center space-y-2">
                  <RefreshCw className="w-7 h-7 text-[#B85B43] mx-auto animate-spin" />
                  <p className="font-bold text-stone-900 text-sm">Reading the bill…</p>
                  <p className="text-stone-500 text-xs font-medium">This usually takes 10–30 seconds.</p>
                </div>
              )}

              {(billScan.stage === "review" || billScan.stage === "saving") && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {([
                      ["supplier", "Supplier", "text"],
                      ["billNumber", "Bill number", "text"],
                      ["billDate", "Bill date", "date"],
                    ] as const).map(([key, label, type]) => (
                      <label key={key} className="block space-y-1">
                        <span className="font-bold text-stone-800 text-xs">{label}</span>
                        <input
                          type={type}
                          value={billScan[key]}
                          onChange={(e) => setBillScan({ ...billScan, [key]: e.target.value })}
                          className="w-full bg-white border border-stone-300 focus:border-[#B85B43] rounded-xl px-3 py-2 text-sm font-medium text-stone-900 outline-none"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="space-y-2.5">
                    {billScan.lines.length === 0 && <p className="text-center text-stone-500 py-4 font-medium text-xs">No items were found on this bill.</p>}
                    {billScan.lines.map((l, idx) => {
                      const matId = l.choice.startsWith("MATCH:") ? Number(l.choice.split(":")[1]) : null;
                      const mat = matId ? rawItems.find((r) => r.id === matId) : undefined;
                      const unitLabel = mat ? mat.unit_of_measure : l.choice === "NEW" ? l.newUnit : "";
                      return (
                        <div key={idx} className={`rounded-xl border p-3.5 space-y-2.5 ${l.choice === "SKIP" ? "border-stone-200 opacity-60 bg-stone-50" : "border-stone-300 bg-white"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-stone-950 text-sm">{l.description || "Unnamed item"}</div>
                              <div className="text-stone-600 font-medium text-xs mt-0.5">
                                On bill: <span className="font-bold text-stone-800">{l.billQty} {l.billUnit}</span>
                                {l.amount != null ? ` · ₹${l.amount.toLocaleString("en-IN")}` : ""}
                              </div>
                            </div>
                            <select
                              value={l.choice}
                              onChange={(e) => updateBillLine(idx, { choice: e.target.value, unitCheck: false })}
                              aria-label={`Raw material for ${l.description}`}
                              className="max-w-[55%] bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 font-bold text-xs text-stone-900 outline-none"
                            >
                              <option value="SKIP">Skip this line</option>
                              <option value="NEW">+ Add as new raw material</option>
                              {rawItems.map((r) => (
                                <option key={r.id} value={`MATCH:${r.id}`}>{r.name} ({r.unit_of_measure})</option>
                              ))}
                            </select>
                          </div>

                          {l.choice !== "SKIP" && (
                            <div className="flex flex-wrap items-end gap-2.5 pt-1 border-t border-stone-100">
                              {l.choice === "NEW" && (
                                <>
                                  <label className="space-y-1 flex-1 min-w-[160px]">
                                    <span className="font-bold text-stone-800 text-xs">New material name</span>
                                    <input value={l.newName} onChange={(e) => updateBillLine(idx, { newName: e.target.value })} className="w-full bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-900 outline-none" />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="font-bold text-stone-800 text-xs">Unit</span>
                                    <select value={l.newUnit} onChange={(e) => updateBillLine(idx, { newUnit: e.target.value })} className="block bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-stone-900 outline-none">
                                      {["kg", "g", "l", "ml", "pcs"].map((u) => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  </label>
                                </>
                              )}
                              <label className="space-y-1">
                                <span className="font-bold text-stone-800 text-xs">Add to stock ({unitLabel})</span>
                                <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => updateBillLine(idx, { quantity: e.target.value, unitCheck: false })} className="block w-28 bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-900 outline-none" />
                              </label>
                              <label className="space-y-1">
                                <span className="font-bold text-stone-800 text-xs">Cost per {unitLabel || "unit"} (₹)</span>
                                <input type="number" min="0" step="any" value={l.unitCost} onChange={(e) => updateBillLine(idx, { unitCost: e.target.value })} className="block w-28 bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-stone-900 outline-none" />
                              </label>
                              <div className="text-stone-800 font-bold text-xs pb-1.5">= ₹{((Number(l.quantity) || 0) * (Number(l.unitCost) || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                            </div>
                          )}
                          {l.unitCheck && l.choice !== "SKIP" && (
                            <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs font-bold">Check quantity: bill uses “{l.billUnit}” but {mat?.name} is tracked in {mat?.unit_of_measure}.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#F0E8DC]">
                    <div className="text-stone-800 font-semibold text-xs">
                      Adding <span className="font-bold text-stone-950">₹{billScan.lines.filter((l) => l.choice !== "SKIP").reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span> before tax
                      {billScan.grandTotal != null && <> · Bill total <span className="font-bold text-stone-950">₹{billScan.grandTotal.toLocaleString("en-IN")}</span> incl. tax</>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setBillScan({ stage: "pick", supplier: "", billNumber: "", billDate: "", grandTotal: null, lines: [] })} disabled={billScan.stage === "saving"} className="px-4 py-2 rounded-xl bg-[#FAF7F0] border border-stone-300 font-bold text-xs text-stone-800 cursor-pointer disabled:opacity-50 hover:bg-stone-100">
                        Scan another
                      </button>
                      <button type="button" onClick={handleConfirmBill} disabled={billScan.stage === "saving"} className="px-4 py-2 rounded-xl bg-[#B85B43] hover:bg-[#9E3E26] text-white font-bold text-xs cursor-pointer disabled:opacity-50 transition-colors shadow-xs">
                        {billScan.stage === "saving" ? "Saving…" : "Confirm & Add to Stock"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Add Raw Material Modal */}
        {newRaw && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFDF9] border border-[#E4DCD0] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-3.5 font-sans text-sm">
              <div className="flex items-start justify-between border-b border-[#F0E8DC] pb-3">
                <h3 className="text-lg font-sans font-extrabold text-stone-950">Add Raw Material</h3>
                <button type="button" onClick={() => setNewRaw(null)} aria-label="Close" className="p-1 rounded-lg text-stone-500 hover:text-stone-950 hover:bg-[#F3EDE2] cursor-pointer">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              {([
                ["name", "Name", "e.g. Parmesan Cheese", "text"],
                ["sku", "SKU", "e.g. RM-PARMESAN", "text"],
                ["stock", "Opening stock", "0", "number"],
                ["reorder", "Reorder at", "0", "number"],
              ] as const).map(([key, label, ph, type]) => (
                <label key={key} className="block space-y-1">
                  <span className="font-bold text-stone-800 text-xs">{label}</span>
                  <input
                    type={type}
                    min={type === "number" ? "0" : undefined}
                    step={type === "number" ? "any" : undefined}
                    value={newRaw[key]}
                    onChange={(e) => setNewRaw({ ...newRaw, [key]: e.target.value })}
                    placeholder={ph}
                    className="w-full bg-white border border-stone-300 focus:border-[#B85B43] rounded-xl px-3 py-2 text-sm font-medium text-stone-900 placeholder:text-stone-400 outline-none"
                  />
                </label>
              ))}
              <label className="block space-y-1">
                <span className="font-bold text-stone-800 text-xs">Unit</span>
                <select
                  value={newRaw.unit}
                  onChange={(e) => setNewRaw({ ...newRaw, unit: e.target.value })}
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-sm font-bold text-stone-900 outline-none"
                >
                  {["kg", "g", "l", "ml", "pcs"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              <div className="pt-2 border-t border-[#F0E8DC] flex justify-end gap-2.5">
                <button type="button" onClick={() => setNewRaw(null)} className="px-4 py-2 rounded-xl bg-[#FAF7F0] border border-stone-300 text-stone-700 font-bold text-xs cursor-pointer hover:bg-stone-100">
                  Cancel
                </button>
                <button type="button" onClick={handleCreateRawItem} className="px-4 py-2 rounded-xl bg-[#B85B43] hover:bg-[#9E3E26] text-white font-bold text-xs cursor-pointer transition-colors shadow-xs">
                  Add Material
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: RESERVATIONS CRM */}
        {activeTab === "reservations" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-serif font-bold text-[#241A14]">Master Reservations Ledger</h2>
                <p className="text-xs text-[#7A6A5E]">
                  View table bookings, advance deposits, and 7-day historical ledger
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C7A6D]" />
                  <Input
                    type="text"
                    value={resSearch}
                    onChange={(e) => setResSearch(e.target.value)}
                    placeholder="Search by Reservation ID, name, phone..."
                    className="pl-9"
                  />
                </div>

                <select
                  value={resFloorFilter}
                  onChange={(e) => setResFloorFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="bg-[#FFFDF9] border border-[#E0D4C2] focus:border-[#B85B43] rounded-xl px-3 py-1.5 text-xs text-[#241A14] outline-none"
                >
                  <option value="all">All Floors</option>
                  {RESTAURANT_FLOORS.filter((f) => !f.isComingSoon).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={resDateFilter}
                  onChange={(e) => setResDateFilter(e.target.value)}
                  className="bg-[#FFFDF9] border border-[#E0D4C2] rounded-xl px-3 py-1.5 text-xs text-[#241A14] outline-none cursor-pointer"
                />
              </div>
            </div>

            {/* SECTION 1: RECENT RESERVATIONS (LAST 7 DAYS - FULL DETAILS) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-serif font-bold text-[#241A14]">Recent Reservations (Last 7 Days)</h3>
                  <Badge variant="success">
                    Full Details ({recentReservations.length})
                  </Badge>
                </div>
              </div>

              <Card className="overflow-hidden shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reservation ID</TableHead>
                      <TableHead>Floor & Table</TableHead>
                      <TableHead>Customer Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Guests</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Deposit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentReservations.length > 0 ? (
                      recentReservations.map((r) => (
                        <TableRow
                          key={r.id}
                          onClick={() => openReservationDetails(r)}
                          className="cursor-pointer"
                        >
                          <TableCell className="font-mono font-bold text-[#B85B43]">
                            {r.booking_id}
                          </TableCell>
                          <TableCell>
                            <span className="font-bold text-[#B85B43] block">
                              {r.floor_name || (r.floor_number ? getFloorName(r.floor_number) : "Ground floor")}
                            </span>
                            <span className="text-[11px] font-mono text-[#665448]">
                              {r.table_name || (r.table_id ? `Table ${r.table_id}` : "Auto Assigned")}
                            </span>
                          </TableCell>
                          <TableCell className="font-bold text-[#241A14]">{r.customer_name}</TableCell>
                          <TableCell className="text-[#665448] font-mono">{r.customer_phone}</TableCell>
                          <TableCell className="text-[#665448] font-semibold">{r.party_size} Guests</TableCell>
                          <TableCell className="text-[#665448]">
                            {r.booking_date} {r.time_slot ? `(${r.time_slot})` : ""}
                          </TableCell>
                          <TableCell>
                            <span className="text-emerald-700 font-bold">
                              ₹{Number(r.advance_amount || 0)} ({r.payment_status})
                            </span>
                            {r.upi_utr && (
                              <span className="block text-[10px] text-[#8C7A6D] font-mono">Ref: {r.upi_utr}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.status === "CONFIRMED"
                                  ? "success"
                                  : r.status === "ARRIVED"
                                    ? "warning"
                                    : r.status === "SEATED"
                                      ? "secondary"
                                      : "default"
                              }
                            >
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openReservationDetails(r);
                              }}
                              className="text-xs h-7 px-2.5"
                            >
                              Details →
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="p-6 text-center text-[#8C7A6D]">
                          No recent reservations in the last 7 calendar days.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>

            {/* SECTION 2: RESERVATION HISTORY (> 7 DAYS - LIMITED DETAILS ONLY) */}
            {historicalReservations.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-serif font-bold text-[#241A14]">Reservation History (Older than 7 Days)</h3>
                    <Badge variant="secondary">
                      Limited Policy View ({historicalReservations.length})
                    </Badge>
                  </div>
                </div>

                <Card className="overflow-hidden shadow-xs">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reservation / Booking ID</TableHead>
                        <TableHead>Customer Name</TableHead>
                        <TableHead>Total Guests</TableHead>
                        <TableHead>Reservation Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historicalReservations.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono font-bold text-[#B85B43]">
                            {r.booking_id}
                          </TableCell>
                          <TableCell className="font-bold text-[#241A14]">{r.customer_name}</TableCell>
                          <TableCell className="text-[#665448] font-semibold">{r.party_size} Guests</TableCell>
                          <TableCell className="text-[#665448]">{r.booking_date}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: GENERALIZED QR CODE HUB */}
        {activeTab === "tables" && (
          <div className="space-y-6">
            {/* Per-table QR codes: pick floor + table, print, next table comes up */}
            {token && <TableQrPrinter token={token} />}

            {/* Shared "generalized" QR (every guest lands on Table 1): hidden now that each table has its own QR */}
            {SHOW_GENERALIZED_QR && (
            <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-serif font-bold text-[#241A14]">Generalized QR Code Hub</h2>
                <p className="text-xs text-[#7A6A5E]">
                  Universal tabletop ordering QR code. Physical tables (1 to 13) are allotted by the POS operator upon guest arrival.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={fetchGeneralizedQrs}
                  disabled={isQrLoading}
                  className="text-xs h-9"
                  title="Refresh QR codes"
                >
                  <RotateCw className={`w-3.5 h-3.5 mr-1.5 ${isQrLoading ? "animate-spin text-[#B85B43]" : ""}`} />
                  <span>Refresh</span>
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  onClick={handleGenerateFreshQr}
                  disabled={qrActionLoading === "generate"}
                  className="text-xs h-9 uppercase tracking-wider"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  <span>{qrActionLoading === "generate" ? "Generating..." : "Generate Fresh QR Code"}</span>
                </Button>
              </div>
            </div>

            {/* Active Generalized QR Code Showcase Card */}
            {activeGenQr ? (
              <Card className="p-8 shadow-sm border border-[#E6DCCF] bg-white rounded-2xl flex flex-col items-center justify-center text-center max-w-xl mx-auto">
                <div className="mb-4">
                  <span className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    activeGenQr.is_active
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-rose-100 text-rose-800 border border-rose-300"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${activeGenQr.is_active ? "bg-emerald-600 animate-pulse" : "bg-rose-600"}`} />
                    {activeGenQr.is_active ? "Active Generalized QR" : "Inactive / Deactivated QR"}
                  </span>
                </div>

                {/* Visual QR Stand Box */}
                <div className="p-6 bg-[#FAF7F0] rounded-2xl border border-[#E8DFC9] flex flex-col items-center justify-center shadow-xs w-full max-w-xs">
                  <p className="mb-3">
                    <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-lg" />
                  </p>
                  {activeGenQrDataUrl ? (
                    <div className="p-3 bg-white rounded-xl border border-[#E2D6C5] shadow-xs">
                      <img
                        src={activeGenQrDataUrl}
                        alt="Active Generalized QR"
                        className="w-52 h-52 object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="w-52 h-52 bg-white rounded-xl border border-[#E2D6C5] flex items-center justify-center">
                      <QrCode className="w-12 h-12 text-stone-300 animate-pulse" />
                    </div>
                  )}
                  <span className="text-xs font-semibold text-[#8C7A6D] mt-3 block">
                    Scan to Order • Table Allotted by POS
                  </span>
                </div>

                {/* Direct Action Buttons */}
                <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleOpenGeneralizedQrPrint(activeGenQr.qr_token, "Generalized Table QR")}
                    className="text-xs h-9 px-4"
                  >
                    <QrCode className="w-3.5 h-3.5 mr-1.5" />
                    <span>Print QR Stand</span>
                  </Button>

                  <Button
                    variant={activeGenQr.is_active ? "outline" : "default"}
                    size="sm"
                    onClick={() => handleToggleQrStatus(activeGenQr.qr_token, activeGenQr.is_active, activeGenQr.id)}
                    disabled={qrActionLoading === activeGenQr.qr_token}
                    className={`text-xs h-9 px-4 ${
                      activeGenQr.is_active
                        ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                        : "bg-emerald-700 hover:bg-emerald-800 text-white"
                    }`}
                  >
                    {qrActionLoading === activeGenQr.qr_token ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    ) : null}
                    <span>{activeGenQr.is_active ? "Inactivate QR" : "Activate QR"}</span>
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center bg-white rounded-2xl border border-[#E6DCCF] space-y-3 max-w-xl mx-auto">
                <QrCode className="w-12 h-12 text-[#B85B43] mx-auto opacity-70" />
                <h3 className="text-base font-bold text-[#241A14]">No Generalized QR Code Found</h3>
                <p className="text-xs text-[#7A6A5E] max-w-sm mx-auto">
                  Click the button below to generate the initial active Generalized QR Code for universal tabletop ordering.
                </p>
                <Button
                  variant="default"
                  onClick={handleGenerateFreshQr}
                  disabled={qrActionLoading === "generate"}
                  className="text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  <span>Generate Initial QR Code</span>
                </Button>
              </Card>
            )}

            {/* QR Registry & History */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#4A392F]">
                    QR Code Registry & Status Control ({generalizedQrs.length})
                  </h3>
                  <p className="text-xs text-[#8C7A6D]">
                    Manage activation states for all generated generalized QR codes. Inactive codes are blocked from ordering.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E6DCCF] overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#FAF7F0] border-b border-[#E8DFC9] text-[#7A6A5E] font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-4">QR Stand</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Created Date</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0E8DC]">
                      {generalizedQrs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-xs text-[#8C7A6D]">
                            No QR codes generated yet.
                          </td>
                        </tr>
                      ) : (
                        generalizedQrs.map((item, idx) => (
                          <tr key={item.qr_token ? `qr-${item.qr_token}-${idx}` : `qr-${item.id || idx}-${idx}`} className="hover:bg-[#FCFAF6] transition-colors">
                            <td className="py-3.5 px-4 font-semibold text-[#241A14]">
                              <span className="flex items-center gap-2">
                                <span>{item.notes || `Generalized Dining QR #${generalizedQrs.length - idx}`}</span>
                                {item.is_active && (
                                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    Active
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  item.is_active
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : "bg-stone-100 text-stone-600 border border-stone-300"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${item.is_active ? "bg-emerald-600" : "bg-stone-400"}`} />
                                {item.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-[#7A6A5E]">
                              {new Date(item.created_at).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleToggleQrStatus(item.qr_token, item.is_active, item.id)}
                                  disabled={qrActionLoading === item.qr_token}
                                  className={`text-[11px] h-7 px-2.5 font-bold ${
                                    item.is_active
                                      ? "text-rose-700 hover:text-rose-800 hover:bg-rose-50"
                                      : "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                  }`}
                                >
                                  {qrActionLoading === item.qr_token ? (
                                    <RotateCw className="w-3 h-3 animate-spin mr-1" />
                                  ) : null}
                                  <span>{item.is_active ? "Inactivate" : "Activate"}</span>
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleOpenGeneralizedQrPrint(item.qr_token, "Generalized Dining QR")}
                                  className="text-[11px] h-7 px-2"
                                  title="View Printable Stand"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                </Button>

                                <Link
                                  href={`/table/${item.qr_token}`}
                                  target="_blank"
                                  className="p-1.5 rounded-md text-[#4A392F] hover:bg-[#F0E8DA] transition-colors"
                                  title="Test Ordering"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Link>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setQrToDelete({
                                      qr_token: item.qr_token,
                                      id: item.id,
                                      name: item.notes || `Generalized Dining QR #${generalizedQrs.length - idx}`,
                                    })
                                  }
                                  disabled={qrActionLoading === `del_${item.qr_token}`}
                                  className="p-1.5 h-7 w-7 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="Delete QR Code"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            </>
            )}
          </div>
        )}

        {/* TAB 5: BILLING & FINANCE LEDGER (Shadcn UI Components) */}
        {activeTab === "ledger" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-serif font-bold text-[#241A14]">Billing & Finance Ledger</h2>
                <p className="text-xs text-[#7A6A5E]">
                  Audit trail of verified scanned supplier inventory invoices and customer dining sales settlements
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => fetchLedgerBills()}
                  disabled={isLedgerLoading}
                  title="Refresh bills"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isLedgerLoading ? "animate-spin text-[#B85B43]" : ""}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => setActiveTab("inventory")}
                  className="text-[#B85B43]"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Scan Supplier Bill</span>
                </Button>

                <Button
                  variant="default"
                  onClick={handleExportCSV}
                  className="uppercase tracking-wider"
                >
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </Button>
              </div>
            </div>

            {/* KPI Metric Summary Cards (Shadcn Card) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A6A5E]">
                    Scanned Inventory Purchases
                  </span>
                  <Package className="w-4 h-4 text-[#B85B43]" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{scannedBills.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0).toLocaleString("en-IN")}
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  {scannedBills.length} confirmed supplier {scannedBills.length === 1 ? "bill" : "bills"}
                </p>
              </Card>

              <Card className="p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A6A5E]">
                    Customer Dining Sales
                  </span>
                  <Receipt className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-extrabold font-sans text-[#241A14] tracking-tight">
                  ₹{customerBills.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0).toLocaleString("en-IN")}
                </div>
                <p className="text-[11px] text-[#7A6A5E] mt-1">
                  {customerBills.length} dining {customerBills.length === 1 ? "settlement" : "settlements"}
                </p>
              </Card>

              <Card className="p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7A6A5E]">
                    Operating Balance
                  </span>
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                </div>
                {(() => {
                  const sales = customerBills.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0);
                  const purchases = scannedBills.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0);
                  const net = sales - purchases;
                  return (
                    <>
                      <div className={`text-2xl font-extrabold font-sans tracking-tight ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {net >= 0 ? "+" : "-"}₹{Math.abs(net).toLocaleString("en-IN")}
                      </div>
                      <p className="text-[11px] text-[#7A6A5E] mt-1">
                        Sales minus inventory raw materials cost
                      </p>
                    </>
                  );
                })()}
              </Card>
            </div>

            {/* Sub-tab Navigation and Search Bar (Shadcn Tabs & Input) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FAF6EE] p-2.5 rounded-2xl border border-[#E6DCCF]">
              <TabsList className="bg-transparent border-0 p-0 gap-1.5 flex">
                <TabsTrigger
                  active={ledgerSubTab === "inventory"}
                  onClick={() => setLedgerSubTab("inventory")}
                  className="gap-2"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Supplier Purchase Bills</span>
                  <Badge variant={ledgerSubTab === "inventory" ? "solid" : "secondary"} className="px-1.5 py-0 text-[10px]">
                    {scannedBills.length}
                  </Badge>
                </TabsTrigger>

                <TabsTrigger
                  active={ledgerSubTab === "sales"}
                  onClick={() => setLedgerSubTab("sales")}
                  className="gap-2"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>Customer Sales Bills</span>
                  <Badge variant={ledgerSubTab === "sales" ? "solid" : "secondary"} className="px-1.5 py-0 text-[10px]">
                    {customerBills.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C7A6D]" />
                <Input
                  type="text"
                  placeholder={ledgerSubTab === "inventory" ? "Search Bill ID, Supplier..." : "Search Bill ID, Table..."}
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* SUB-VIEW 1: SCANNED INVENTORY SUPPLIER BILLS (Shadcn Table) */}
            {ledgerSubTab === "inventory" && (
              <Card className="overflow-hidden shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill ID / Invoice #</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Bill Date</TableHead>
                      <TableHead>Items Received</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scanned At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const filtered = scannedBills.filter((b) => {
                        if (!ledgerSearch) return true;
                        const q = ledgerSearch.toLowerCase();
                        return (
                          (b.bill_id && b.bill_id.toLowerCase().includes(q)) ||
                          (b.bill_number && b.bill_number.toLowerCase().includes(q)) ||
                          (b.supplier_name && b.supplier_name.toLowerCase().includes(q)) ||
                          (b.bill_date && b.bill_date.includes(q))
                        );
                      });

                      if (filtered.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={8} className="p-10 text-center">
                              <div className="max-w-md mx-auto space-y-3">
                                <div className="w-12 h-12 rounded-2xl bg-[#F3EDE2] text-[#B85B43] flex items-center justify-center mx-auto">
                                  <ScanLine className="w-6 h-6" />
                                </div>
                                <p className="font-bold text-[#241A14]">
                                  {ledgerSearch ? "No matching supplier bills found" : "No scanned supplier bills recorded yet"}
                                </p>
                                <p className="text-xs text-[#7A6A5E]">
                                  Upload supplier invoices in <span className="font-semibold text-[#241A14]">Inventory &gt; Scan Supplier Bill</span>. Sarvam AI extracts line items, quantities, and bill ID into stock.
                                </p>
                                <Button
                                  onClick={() => setActiveTab("inventory")}
                                  className="mx-auto"
                                >
                                  <ScanLine className="w-3.5 h-3.5" />
                                  <span>Go to Inventory &amp; Scan Bill</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return filtered.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Badge variant="default" className="font-mono text-xs">
                              {b.bill_id || b.bill_number}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-bold text-[#241A14]">
                            {b.supplier_name}
                          </TableCell>
                          <TableCell className="text-[#665448]">
                            {b.bill_date || "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setSelectedScannedBill(b)}
                              className="text-[11px]"
                            >
                              <span>{b.items_count} {b.items_count === 1 ? "item" : "items"}</span>
                              <ChevronRight className="w-3 h-3 text-[#8C7A6D]" />
                            </Button>
                          </TableCell>
                          <TableCell className="font-extrabold text-[#241A14]">
                            ₹{Number(b.total_amount || 0).toLocaleString("en-IN")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="success">
                              {b.status || "RECEIVED"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[#8C7A6D] font-mono text-[11px]">
                            {b.created_at ? new Date(b.created_at).toLocaleString("en-IN") : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="link"
                              onClick={() => setSelectedScannedBill(b)}
                              className="text-xs"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Inspect Bill</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </Card>
            )}

            {/* SUB-VIEW 2: CUSTOMER DINING SALES BILLS (Shadcn Table) */}
            {ledgerSubTab === "sales" && (
              <Card className="overflow-hidden shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill ID</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Subtotal</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>GST (5%)</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Date Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const filtered = customerBills.filter((c) => {
                        if (!ledgerSearch) return true;
                        const q = ledgerSearch.toLowerCase();
                        return (
                          c.bill_id.toLowerCase().includes(q) ||
                          c.table_number.toLowerCase().includes(q) ||
                          (c.customer_name && c.customer_name.toLowerCase().includes(q))
                        );
                      });

                      if (filtered.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={9} className="p-8 text-center text-[#8C7A6D]">
                              {ledgerSearch ? "No matching dining bills found." : "No dining bills generated yet."}
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return filtered.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <Badge variant="default" className="font-mono text-xs">
                              {c.bill_id}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-bold text-[#241A14]">
                            {c.table_number}
                          </TableCell>
                          <TableCell className="text-[#665448]">
                            {c.customer_name || "Walk-in Guest"}
                          </TableCell>
                          <TableCell className="text-[#665448]">
                            ₹{Number(c.subtotal || 0).toLocaleString("en-IN")}
                          </TableCell>
                          <TableCell className="text-emerald-700 font-medium">
                            {Number(c.discount_amount || 0) > 0 ? `-₹${Number(c.discount_amount).toLocaleString("en-IN")}` : "—"}
                          </TableCell>
                          <TableCell className="text-[#665448]">
                            ₹{Number(c.tax_amount || 0).toLocaleString("en-IN")}
                          </TableCell>
                          <TableCell className="font-extrabold text-[#241A14]">
                            ₹{Number(c.total_amount || 0).toLocaleString("en-IN")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.is_paid ? "success" : "warning"}>
                              {c.is_paid ? "PAID" : "UNPAID"} • {c.payment_method || "CASH"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[#8C7A6D] font-mono text-[11px]">
                            {c.created_at ? new Date(c.created_at).toLocaleString("en-IN") : "—"}
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        )}
      </main>


      {/* MODAL: EDIT MENU ITEM (PRICE & AVAILABILITY) */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveMenuItem(editingItem);
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 shadow-2xl space-y-4 text-[#241A14]"
            >
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <h3 className="text-base font-serif font-bold text-[#241A14]">Edit Menu Item</h3>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="text-[#8C7A6D] hover:text-[#241A14] text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Dish photo */}
                <div>
                  <span className="font-bold text-[#665448] block mb-1">Dish Photo</span>
                  <div className="flex items-center gap-3">
                    <div className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden border border-[#E2D6C5] bg-[#FAF7F0] flex items-center justify-center">
                      {editingItem.image_url || defaultDishImage(editingItem.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={(editingItem.image_url || defaultDishImage(editingItem.id)) as string}
                          alt={`Photo of ${editingItem.name}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-[#8C7A6D] text-center px-1">No photo</span>
                      )}
                      {photoBusy && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-[10px] font-bold text-[#665448]">
                          {photoBusy === "uploading" ? "Uploading…" : "Removing…"}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 min-w-0">
                      <p className="text-[11px] text-[#8C7A6D] leading-snug">
                        {editingItem.image_url ? "Uploaded photo, shown on the website and QR menu." : "Website's default picture. Upload a photo to replace it."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <label className={`px-3 py-1.5 rounded-lg bg-[#241A14] hover:bg-[#B85B43] text-white font-bold transition-colors ${photoBusy ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                          {editingItem.image_url ? "Change Photo" : "Upload Photo"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/*"
                            className="sr-only"
                            disabled={!!photoBusy}
                            onChange={(e) => {
                              handleDishPhotoSelected(editingItem, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {editingItem.image_url && (
                          <button
                            type="button"
                            disabled={!!photoBusy}
                            onClick={() => handleRemoveDishPhoto(editingItem)}
                            className="px-3 py-1.5 rounded-lg border border-[#E2D6C5] text-[#9E3E26] font-bold hover:bg-[#FBEDE8] disabled:opacity-50 cursor-pointer"
                          >
                            Remove Photo
                          </button>
                        )}
                      </div>
                      {photoError && <p role="alert" className="text-[11px] font-semibold text-rose-700">{photoError}</p>}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Item Name</label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={editingItem.description || ""}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Price (₹ INR)</label>
                  <input
                    type="number"
                    required
                    step="1"
                    value={editingItem.price}
                    onChange={(e) => setEditingItem({ ...editingItem, price: Number(e.target.value) })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-bold text-base outline-none"
                  />
                </div>

                <div className="pt-2">
                  <label className="font-bold text-[#665448] block mb-1.5">Availability Status</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, is_available: true })}
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${editingItem.is_available
                          ? "bg-emerald-100 text-emerald-800 border-emerald-400 shadow-2xs"
                          : "bg-[#FAF7F0] text-[#7A6A5E] border-[#E2D6C5]"
                        }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      <span>In Stock</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, is_available: false })}
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${!editingItem.is_available
                          ? "bg-rose-100 text-rose-800 border-rose-400 shadow-2xs"
                          : "bg-[#FAF7F0] text-[#7A6A5E] border-[#E2D6C5]"
                        }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-rose-600" />
                      <span>86'd (Sold Out)</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F0E8DC]">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F0E8DA] text-[#665448] text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingItem}
                  className="px-6 py-2.5 rounded-xl bg-[#B85B43] hover:bg-[#A34B34] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer shadow-md flex items-center gap-2"
                >
                  {isSavingItem ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: CREATE MENU ITEM */}
      <AnimatePresence>
        {isCreatingItem && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.form
              onSubmit={handleCreateMenuItem}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 shadow-2xl space-y-4 text-[#241A14]"
            >
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <h3 className="text-base font-serif font-bold text-[#241A14]">Add New Menu Item</h3>
                <button
                  type="button"
                  onClick={() => setIsCreatingItem(false)}
                  className="text-[#8C7A6D] hover:text-[#241A14] text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-[#665448] block mb-1">Item Name</label>
                  <input
                    type="text"
                    required
                    value={newItemData.name}
                    onChange={(e) => setNewItemData({ ...newItemData, name: e.target.value })}
                    placeholder="e.g. Quattro Formaggi Pizza"
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Category</label>
                  <select
                    value={newItemData.category_id}
                    onChange={(e) => setNewItemData({ ...newItemData, category_id: Number(e.target.value) })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] outline-none font-semibold"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={newItemData.description}
                    onChange={(e) => setNewItemData({ ...newItemData, description: e.target.value })}
                    placeholder="Artisanal sourdough crust, fresh mozzarella, gorgonzola..."
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Price (₹ INR)</label>
                  <input
                    type="number"
                    required
                    value={newItemData.price}
                    onChange={(e) => setNewItemData({ ...newItemData, price: Number(e.target.value) })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-bold outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F0E8DC]">
                <button
                  type="button"
                  onClick={() => setIsCreatingItem(false)}
                  className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F0E8DA] text-[#665448] text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[#B85B43] hover:bg-[#A34B34] text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md"
                >
                  Create Item
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: CREATE CATEGORY */}
      <AnimatePresence>
        {isCreatingCategory && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.form
              onSubmit={handleCreateCategory}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 shadow-2xl space-y-4 text-[#241A14]"
            >
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <div className="flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-[#B85B43]" />
                  <h3 className="text-base font-serif font-bold text-[#241A14]">Add New Food Category</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingCategory(false)}
                  className="text-[#8C7A6D] hover:text-[#241A14] text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-[#665448] block mb-1">Category Name</label>
                  <input
                    type="text"
                    required
                    value={newCategoryData.name}
                    onChange={(e) => setNewCategoryData({ ...newCategoryData, name: e.target.value })}
                    placeholder="e.g. Artisanal Garlic Breads, Calzones, Mocktails"
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-medium outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Display Order (Menu Sort)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newCategoryData.display_order}
                    onChange={(e) => setNewCategoryData({ ...newCategoryData, display_order: Number(e.target.value) })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-bold outline-none"
                  />
                  <p className="text-[11px] text-[#8C7A6D] mt-1">Lower numbers appear first on customer menus and POS.</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F0E8DC]">
                <button
                  type="button"
                  onClick={() => setIsCreatingCategory(false)}
                  className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F0E8DA] text-[#665448] text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[#B85B43] hover:bg-[#A34B34] text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md"
                >
                  Create Category
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: EDIT CATEGORY */}
      <AnimatePresence>
        {editingCategory && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.form
              onSubmit={handleUpdateCategory}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 shadow-2xl space-y-4 text-[#241A14]"
            >
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <div className="flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-[#B85B43]" />
                  <h3 className="text-base font-serif font-bold text-[#241A14]">Edit Food Category</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="text-[#8C7A6D] hover:text-[#241A14] text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-[#665448] block mb-1">Category Name</label>
                  <input
                    type="text"
                    required
                    value={editCategoryData.name}
                    onChange={(e) => setEditCategoryData({ ...editCategoryData, name: e.target.value })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-medium outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-[#665448] block mb-1">Display Order</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editCategoryData.display_order}
                    onChange={(e) => setEditCategoryData({ ...editCategoryData, display_order: Number(e.target.value) })}
                    className="w-full bg-[#FAF7F0] border border-[#E2D6C5] focus:border-[#B85B43] focus:bg-white rounded-xl p-3 text-[#241A14] font-bold outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#F0E8DC]">
                <button
                  type="button"
                  onClick={() => {
                    handleDeleteCategory(editingCategory.id, editingCategory.name);
                    setEditingCategory(null);
                  }}
                  className="px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors cursor-pointer border border-rose-200"
                >
                  Deactivate Category
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCategory(null)}
                    className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F0E8DA] text-[#665448] text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-[#B85B43] hover:bg-[#A34B34] text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-md"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: PRINTABLE TABLE QR CODE */}
      <AnimatePresence>
        {qrModalTable && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-[#FFFDF9] text-[#241A14] rounded-3xl p-6 shadow-2xl text-center space-y-4 border border-[#E6DCCF]"
            >
              <div className="border-b border-[#F0E8DC] pb-3 flex flex-col items-center">
                <p className="pt-3 mb-2">
                  <BrandTitle className="font-poppins font-bold tracking-wide text-[#5F3F6D] text-lg" />
                </p>
                <div className="w-28 h-16 rounded-xl overflow-hidden border-2 border-[#9E3E26]/40 shadow-md mb-2.5 bg-white">
                  <img
                    src="/jaadoo_logo.jpg"
                    alt="Jaadoo Logo"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-xs font-semibold text-[#665448]">{qrModalTable.number}</p>
              </div>

              {/* QR Image */}
              <div className="p-3 bg-white rounded-2xl border border-[#E6DCCF] flex justify-center shadow-inner">
                <img src={qrModalTable.qrDataUrl} alt={`QR Table ${qrModalTable.number}`} className="w-56 h-56 rounded-lg" />
              </div>

              <div className="p-3 bg-[#FBF7EE] border border-dashed border-[#B85B43]/50 rounded-xl text-xs text-[#5A4A3D] space-y-1 text-center">
                <p className="font-bold text-[#B85B43]">Reservation ID Instruction</p>
                <p className="leading-relaxed">
                  Reservation ID is the first 4 letters of your name and last 4 numbers of your phone number (e.g. JOHN3210).
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => {
                    const win = window.open("", "_blank");
                    if (win) {
                      win.document.write(`
                        <html>
                          <head>
                            <title>${qrModalTable.number} - QR Card</title>
                            <style>
                              @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&display=swap');
                              body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; background: #FAF7F0; color: #241A14; }
                              .card { background: #fff; padding: 24px; border-radius: 16px; border: 2px solid #E2D6C5; max-width: 360px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
                              .brand { font-family: 'Poppins', sans-serif; font-weight: 700; color: #5F3F6D; font-size: 18px; margin: 0 0 8px 0; }
                              h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 800; color: #241A14; }
                              p.sub { color: #B85B43; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 14px 0; }
                              .logo { width: 140px; height: 80px; object-fit: cover; border-radius: 12px; margin-bottom: 8px; border: 2px solid #E2D6C5; }
                              .qr { width: 260px; height: 260px; border-radius: 12px; }
                              .instruction { margin: 12px 0 6px 0; padding: 8px 12px; background: #FBF7EE; border: 1px dashed #B85B43; border-radius: 8px; font-size: 11px; line-height: 1.4; color: #4A392F; font-weight: 500; text-align: center; }
                              .instruction strong { color: #B85B43; font-weight: 800; display: block; margin-bottom: 2px; }
                              .foot { margin-top: 12px; font-size: 11px; color: #776; font-weight: 500; }
                            </style>
                          </head>
                          <body onload="window.print()">
                            <div class="card">
                              <img class="logo" src="${window.location.origin}/jaadoo_logo.jpg" alt="Jaadoo Pizza Project logo" />
                              <div class="brand">Jaadoo Pizza Project</div>
                              <h1>${qrModalTable.number.includes("Table") ? qrModalTable.number : "Scan to Order"}</h1>
                              <p class="sub">Table allotted by POS operator</p>
                              <img class="qr" src="${qrModalTable.qrDataUrl}" alt="Table QR code" />
                              <div class="instruction">
                                <strong>Reservation ID Instruction</strong>
                                Reservation ID is your first 4 letters of name and last 4 numbers of phone number (e.g. JOHN3210).
                              </div>
                              <div class="foot">Scan to Order • 32 Sitaphal ki gali, Ganesh Ghati, Udaipur</div>
                            </div>
                          </body>
                        </html>
                      `);
                      win.document.close();
                    }
                  }}
                  className="flex-1 bg-[#B85B43] hover:bg-[#A34B34] text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
                >
                  Print Card
                </button>

                <button
                  onClick={() => setQrModalTable(null)}
                  className="px-4 py-2.5 rounded-xl bg-[#FAF6EE] hover:bg-[#F0E8DA] border border-[#E0D4C2] text-[#4A392F] text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* SHADCN-STYLE DELETE CONFIRMATION MODAL */}
        {qrToDelete && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md bg-[#FFFDF9] border border-[#E6DCCF] rounded-2xl p-6 shadow-2xl space-y-4 text-[#241A14]"
            >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-full bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-[#241A14]">
                    Delete QR Stand Code?
                  </h3>
                  <p className="text-xs text-[#665448] leading-relaxed">
                    Are you sure you want to delete <span className="font-bold text-[#241A14]">"{qrToDelete.name}"</span>? Any printed stand with this QR code will no longer accept guest orders.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>This action cannot be undone. Guests scanning this stand will be notified it is deactivated.</span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQrToDelete(null)}
                  disabled={qrActionLoading?.startsWith("del_")}
                  className="text-xs h-9 px-4 font-semibold border-[#D8CABE] text-[#4A392F] hover:bg-[#F5EFE6]"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={confirmDeleteQr}
                  disabled={qrActionLoading?.startsWith("del_")}
                  className="text-xs h-9 px-4 font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs"
                >
                  {qrActionLoading?.startsWith("del_") ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      <span>Delete QR Code</span>
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Table Session Details Modal in Operations */}
        {selectedOpTable && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-[#FFFDF9] border border-[#E4DCD0] rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-[#F0E8DC] pb-3">
                <div>
                  {(() => {
                    const selFloor = getTableFloor(selectedOpTable.table_id || selectedOpTable.table_number, selectedOpTable.floor_number);
                    const selNum = selectedOpTable.floor_table_num || selFloor.floor_table_num;
                    return (
                      <h3 className="text-xl font-sans font-extrabold text-[#241A14]">
                        Table {selNum} ({selectedOpTable.floor_name || selFloor.name}) Bill Summary
                      </h3>
                    );
                  })()}
                  <p className="text-xs text-[#7A6A5E] mt-0.5">
                    Date: {opDate} • {(selectedOpTable.sessions || []).length} Bills
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOpTable(null)}
                  className="p-1 rounded-lg text-[#8C7A6D] hover:text-[#241A14] hover:bg-[#F3EDE2] cursor-pointer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between bg-[#FAF7F0] p-3 rounded-xl border border-[#E0D4C2]">
                  <span className="font-semibold text-[#665448]">Day Total:</span>
                  <span className="font-mono font-extrabold text-base text-[#B85B43]">
                    ₹{(selectedOpTable.sessions || []).reduce((sum: number, s: any) => sum + Number(s.gross_amount || s.total_amount || 0), 0).toLocaleString("en-IN")}
                  </span>
                </div>

                {(selectedOpTable.sessions || []).length > 0 ? (
                  <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
                    {(selectedOpTable.sessions || []).map((s: any) => {
                      const time = (d?: string) =>
                        d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
                      return (
                        <div key={s.session_id} className="rounded-xl border border-[#E0D4C2] p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#241A14]">Bill #{s.session_seq}</span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${s.is_active ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                                }`}
                            >
                              {s.is_active ? "Open" : s.is_settled ? "Settled" : "Closed"}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#7A6A5E]">
                            {time(s.opened_at)} → {s.is_active ? "now" : time(s.closed_at)}
                            {s.customer_name ? ` • ${s.customer_name}` : ""}
                          </div>

                          {(s.items || []).length > 0 ? (
                            <div className="space-y-1 divide-y divide-[#F0E8DC]">
                              {s.items.map((it: any, idx: number) => (
                                <div key={idx} className="pt-1 flex items-center justify-between">
                                  <span className="text-[#241A14]">{it.quantity}x {it.name}</span>
                                  <span className="font-mono text-[#241A14]">
                                    ₹{Number(it.subtotal || it.unit_price * it.quantity || 0).toLocaleString("en-IN")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[#8C7A6D]">No items.</p>
                          )}

                          <div className="pt-2 border-t border-[#F0E8DC] space-y-0.5">
                            <div className="flex justify-between text-[#665448]">
                              <span>Subtotal</span>
                              <span className="font-mono">₹{Number(s.subtotal || 0).toLocaleString("en-IN")}</span>
                            </div>
                            {Number(s.discount_amount || 0) > 0 && (
                              <div className="flex justify-between text-emerald-700">
                                <span>
                                  Discount{s.discount_type === "PERCENT" ? ` (${Number(s.discount_value)}%)` : ""}
                                  {s.discount_reason ? ` · ${s.discount_reason}` : ""}
                                </span>
                                <span className="font-mono">−₹{Number(s.discount_amount).toLocaleString("en-IN")}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-[#665448]">
                              <span>Tax</span>
                              <span className="font-mono">₹{Number(s.tax_amount || 0).toLocaleString("en-IN")}</span>
                            </div>
                            <div className="flex justify-between font-bold text-[#241A14]">
                              <span>Total</span>
                              <span className="font-mono text-[#B85B43]">₹{Number(s.gross_amount || s.total_amount || 0).toLocaleString("en-IN")}</span>
                            </div>
                            {Number(s.reservation_credit || 0) > 0 && (
                              <>
                                <div className="flex justify-between text-[#665448]">
                                  <span>Advance Adjusted</span>
                                  <span className="font-mono">−₹{Number(s.reservation_credit).toLocaleString("en-IN")}</span>
                                </div>
                                <div className="flex justify-between font-bold text-[#241A14]">
                                  <span>Net Payable</span>
                                  <span className="font-mono">₹{Number(s.net_amount_due || 0).toLocaleString("en-IN")}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[#8C7A6D] text-center py-4">No bills for this table on {opDate}.</p>
                )}
              </div>

              <div className="pt-2 border-t border-[#F0E8DC] flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedOpTable(null)}
                  className="px-4 py-2 rounded-xl bg-[#261C18] text-white text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Full Reservation Details Modal */}
        {selectedResDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
            <div className="bg-[#FFFDF9] rounded-2xl w-full max-w-lg p-6 border border-[#E0D4C2] shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#E0D4C2] pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[#B85B43]" />
                  <div>
                    <h3 className="font-serif font-bold text-base text-[#241A14]">
                      Reservation Details
                    </h3>
                    <p className="text-xs font-mono font-bold text-[#B85B43]">
                      {selectedResDetails.booking_id}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedResDetails(null); setConfirmCancelRes(false); setArrivalTableId(""); }}
                  className="p-1 rounded-lg hover:bg-[#FAF7F0] text-[#665448] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Guest & Party Info */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-[#FAF7F0] p-3.5 rounded-xl border border-[#E0D4C2]">
                <div>
                  <span className="text-[#8C7A6D] uppercase text-[10px] font-bold block">Guest Name</span>
                  <span className="font-bold text-[#241A14] text-sm">{selectedResDetails.customer_name}</span>
                </div>
                <div>
                  <span className="text-[#8C7A6D] uppercase text-[10px] font-bold block">Phone</span>
                  <span className="font-mono text-[#241A14]">{selectedResDetails.customer_phone || "Not provided"}</span>
                </div>
                <div>
                  <span className="text-[#8C7A6D] uppercase text-[10px] font-bold block">Party Size</span>
                  <span className="font-bold text-[#241A14]">{selectedResDetails.party_size} Guests</span>
                </div>
                <div>
                  <span className="text-[#8C7A6D] uppercase text-[10px] font-bold block">Date & Time Slot</span>
                  <span className="font-bold text-[#B85B43]">
                    {selectedResDetails.booking_date} • {selectedResDetails.time_slot}
                  </span>
                </div>
              </div>

              {/* Table Seating Info */}
              <div className="text-xs space-y-2">
                <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-[#E0D4C2]">
                  <div>
                    <span className="text-[#8C7A6D] text-[10px] uppercase font-bold block">Assigned Table & Floor</span>
                    <span className="font-bold text-[#241A14]">
                      {selectedResDetails.table_name || (selectedResDetails.table_id ? `Table ${selectedResDetails.table_id}` : "Auto Assigned")}
                    </span>
                    <span className="text-[#8C7A6D] ml-2">
                      ({selectedResDetails.floor_name || (selectedResDetails.floor_number ? getFloorName(selectedResDetails.floor_number) : "Ground Floor")})
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${selectedResDetails.status === "CONFIRMED"
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                        : selectedResDetails.status === "ARRIVED"
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : selectedResDetails.status === "SEATED"
                            ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                            : "bg-stone-100 text-stone-700 border border-stone-300"
                      }`}
                  >
                    {selectedResDetails.status}
                  </span>
                </div>
              </div>

              {/* Deposit & Payment Ledger */}
              <div className="bg-[#FAF7F0] p-3.5 rounded-xl border border-[#E0D4C2] text-xs space-y-2">
                <h4 className="font-serif font-bold text-xs text-[#241A14] uppercase tracking-wider">
                  Payment & Advance Deposit
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[#8C7A6D] block">Advance Amount:</span>
                    <span className="font-bold text-emerald-800 font-mono text-sm">
                      ₹{Number(selectedResDetails.advance_amount || 0).toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#8C7A6D] block">Payment Status:</span>
                    <span className="font-bold text-[#241A14]">{selectedResDetails.payment_status || "PENDING"}</span>
                  </div>
                  {selectedResDetails.upi_utr && (
                    <div className="col-span-2">
                      <span className="text-[#8C7A6D] block">Bank / UPI Reference (UTR):</span>
                      <span className="font-mono font-bold text-[#241A14]">{selectedResDetails.upi_utr}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Cancellation outcome */}
              {selectedResDetails.status === "CANCELLED" && (
                <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-200 text-xs space-y-1">
                  <h4 className="font-serif font-bold text-xs text-rose-900 uppercase tracking-wider">Reservation Cancelled</h4>
                  <div className="flex justify-between text-rose-900">
                    <span>Refund due to guest:</span>
                    <span className="font-mono font-bold">₹{Number(selectedResDetails.cancellation_refund_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-rose-900">
                    <span>Refund status:</span>
                    <span className="font-bold">{(selectedResDetails.cancellation_refund_status || "NO_REFUND").replace(/_/g, " ")}</span>
                  </div>
                  {Number(selectedResDetails.cancellation_refund_amount || 0) > 0 && (
                    <p className="text-[11px] text-rose-800 pt-1">
                      Refunds are not sent automatically. Return this amount to the guest via the original payment method.
                    </p>
                  )}
                </div>
              )}

              {/* Quick Status Actions */}
              {["CONFIRMED", "ARRIVED", "SEATED"].includes(selectedResDetails.status) && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-xs font-bold text-[#4A392F] uppercase tracking-wider block">
                    Update Reservation Status:
                  </span>
                  <div className="space-y-2">
                    {["CONFIRMED", "ARRIVED"].includes(selectedResDetails.status) && (
                      <>
                        {!selectedResDetails.table_id && (
                          <label className="block text-xs space-y-1">
                            <span className="font-bold text-[#4A392F]">No table assigned — seat guest at:</span>
                            <select
                              value={arrivalTableId}
                              onChange={(e) => setArrivalTableId(e.target.value ? Number(e.target.value) : "")}
                              className="w-full bg-[#FAF6EE] border border-[#E0D4C2] rounded-xl px-3 py-2 outline-none"
                            >
                              <option value="">Choose a table…</option>
                              {RESTAURANT_TABLES.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.table_number} · {getFloorName(t.floor)} ({t.capacity} seats)
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => handleGuestArrived(selectedResDetails)}
                          disabled={isCheckingIn || (!selectedResDetails.table_id && arrivalTableId === "")}
                          className="w-full py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isCheckingIn ? "Checking in…" : "Guest Arrived · Check In & Seat"}
                        </button>
                      </>
                    )}

                    {selectedResDetails.status === "SEATED" && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await handleUpdateOpReservationStatus(selectedResDetails.id, "COMPLETED")) setSelectedResDetails({ ...selectedResDetails, status: "COMPLETED" });
                        }}
                        className="w-full py-2 rounded-xl bg-[#261C18] hover:bg-[#B85B43] text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        Complete
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Cancel Reservation (only for statuses the backend allows to cancel) */}
              {["HOLD", "PAYMENT_PENDING", "PENDING", "CONFIRMED", "ARRIVED"].includes(selectedResDetails.status) &&
                (confirmCancelRes ? (
                  <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-200 text-xs space-y-2.5">
                    <p className="font-bold text-rose-900">
                      Cancel {selectedResDetails.booking_id} for{" "}
                      {selectedResDetails.customer_name}?
                    </p>
                    <p className="text-rose-800">
                      {Number(selectedResDetails.advance_amount || 0) > 0 && selectedResDetails.payment_status === "PAID"
                        ? `The ₹${Number(selectedResDetails.advance_amount).toFixed(2)} advance will be refunded according to your cancellation policy. `
                        : ""}
                      The table and reserved pizza capacity will be released. This cannot be undone.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmCancelRes(false)}
                        disabled={isCancellingRes}
                        className="py-2 rounded-xl bg-white border border-[#E0D4C2] text-[#241A14] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Keep Reservation
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelReservation(selectedResDetails.id)}
                        disabled={isCancellingRes}
                        className="py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        {isCancellingRes ? "Cancelling..." : "Yes, Cancel"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancelRes(true)}
                    className="w-full py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs transition-colors cursor-pointer"
                  >
                    Cancel Reservation
                  </button>
                ))}

              <div className="pt-3 border-t border-[#E0D4C2] flex justify-end">
                <button
                  type="button"
                  onClick={() => { setSelectedResDetails(null); setConfirmCancelRes(false); setArrivalTableId(""); }}
                  className="px-5 py-2.5 bg-[#261C18] hover:bg-[#B85B43] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: INSPECT SCANNED INVENTORY SUPPLIER BILL */}
        {selectedScannedBill && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#FFFDF9] border border-[#E6DCCF] rounded-3xl p-6 shadow-2xl space-y-4 text-[#241A14] max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-[#F0E8DC] pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F3EDE2] text-[#B85B43] flex items-center justify-center">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-serif font-bold text-[#241A14]">
                        Supplier Invoice Breakdown
                      </h3>
                      <span className="font-mono font-bold bg-[#FAF6EE] text-[#B85B43] px-2 py-0.5 rounded-lg border border-[#E0D4C2] text-xs">
                        {selectedScannedBill.bill_id || selectedScannedBill.bill_number}
                      </span>
                    </div>
                    <p className="text-xs text-[#7A6A5E]">
                      {selectedScannedBill.supplier_name} {selectedScannedBill.bill_date ? `• Dated ${selectedScannedBill.bill_date}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedScannedBill(null)}
                  className="text-[#8C7A6D] hover:text-[#241A14] text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Bill Details Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FAF6EE] p-3 rounded-2xl border border-[#E6DCCF] text-xs">
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#7A6A5E]">Supplier</div>
                  <div className="font-bold text-[#241A14] truncate">{selectedScannedBill.supplier_name}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#7A6A5E]">Invoice Date</div>
                  <div className="font-bold text-[#241A14]">{selectedScannedBill.bill_date || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#7A6A5E]">Status</div>
                  <div className="font-bold text-emerald-700">{selectedScannedBill.status || "RECEIVED"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-[#7A6A5E]">Total Invoice Cost</div>
                  <div className="font-extrabold text-[#B85B43]">
                    ₹{Number(selectedScannedBill.total_amount || 0).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              {/* Itemized Lines */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#7A6A5E] mb-2">
                  Line Items Added To Inventory ({selectedScannedBill.items?.length || 0})
                </h4>
                <div className="bg-[#FAF7F0] border border-[#E6DCCF] rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F0E8DC] text-[#4A392F] uppercase tracking-wider font-bold">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Raw Material</th>
                        <th className="p-3">Quantity</th>
                        <th className="p-3">Unit Cost</th>
                        <th className="p-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6DCCF]">
                      {(selectedScannedBill.items && selectedScannedBill.items.length > 0) ? (
                        selectedScannedBill.items.map((it, idx) => (
                          <tr key={it.id || idx}>
                            <td className="p-3 text-[#8C7A6D]">{idx + 1}</td>
                            <td className="p-3 font-bold text-[#241A14]">{it.name}</td>
                            <td className="p-3 text-[#4A392F]">
                              {it.quantity} {it.unit}
                            </td>
                            <td className="p-3 text-[#665448]">
                              ₹{Number(it.unit_cost || 0).toFixed(2)} / {it.unit}
                            </td>
                            <td className="p-3 font-bold text-[#241A14] text-right">
                              ₹{Number(it.subtotal || 0).toLocaleString("en-IN")}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-[#8C7A6D]">
                            No line items recorded for this invoice.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {(selectedScannedBill.items && selectedScannedBill.items.length > 0) && (
                      <tfoot className="bg-[#F0E8DC] font-bold text-[#241A14]">
                        <tr>
                          <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-xs">
                            Total Cost
                          </td>
                          <td className="p-3 text-right text-sm font-extrabold text-[#B85B43]">
                            ₹{Number(selectedScannedBill.total_amount || 0).toLocaleString("en-IN")}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E0D4C2] flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedScannedBill(null)}
                  className="px-5 py-2.5 bg-[#261C18] hover:bg-[#B85B43] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
