"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import BrandTitle from "@/components/BrandTitle";
import {
  TrendingUp,
  Receipt,
  CreditCard,
  Wallet,
  CalendarDays,
  UtensilsCrossed,
  RefreshCw,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Eye,
  Check,
  X,
  Plus,
  Edit2,
  AlertTriangle,
  Info,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  HelpCircle,
  Store,
  ExternalLink,
} from "lucide-react";
import { managerSession } from "@/lib/authFetch";
import { formatBookingId } from "@/lib/bookingId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";

const {
  fetch: managerFetch,
  tokenKey: MANAGER_TOKEN_KEY,
  refreshKey: MANAGER_REFRESH_KEY,
  expiredEvent: MANAGER_SESSION_EXPIRED,
  refreshedEvent: MANAGER_TOKEN_REFRESHED,
} = managerSession;

// Types
interface OverviewData {
  period: {
    start: string;
    end: string;
    duration_days: number;
    prior_start: string;
    prior_end: string;
  };
  revenue: {
    gross_subtotal: string;
    discounts: string;
    taxes: string;
    total_dining_consumption: string;
    reservation_credits_applied: string;
    net_pos_checkout_due: string;
    net_sales: string;
    prior_net_sales: string;
    revenue_growth_pct: number | null;
    completed_bills_count: number;
    aov: string;
    accounting_note?: string;
  };
  collections: {
    net_checkout_collections: string;
    advance_deposits_collected: string;
    total_funds_collected: string;
    by_method: Record<string, string>;
    counts_by_method: Record<string, number>;
  };
  upi_reconciliation: {
    verified_settled_amount: string;
    verified_settled_count: number;
    review_required_amount: string;
    review_required_count: number;
    failed_amount: string;
    failed_count: number;
    payment_ledger_upi_amount: string;
    unverified_upi_records_count: number;
  };
  petty_cash: {
    is_configured: boolean;
    status: string;
    opening_balance: string | null;
    closing_balance: string | null;
    audit_note: string;
  };
  expenses: {
    received_expenses: string;
    received_count: number;
    ordered_commitments: string;
    ordered_count: number;
    suppliers_breakdown: Record<string, string>;
  };
  profit_and_loss: {
    status: string;
    calculation_basis: string;
    net_sales: string;
    cost_basis_amount: string;
    provisional_surplus: string;
    is_provisional: boolean;
    disclosure: string;
  };
  outstanding: {
    amount: string;
    count: number;
  };
  reservations: {
    total_count: number;
    by_status: Record<string, number>;
    advance_collected: string;
  };
}

interface AnalyticsData {
  period: { start: string; end: string };
  time_series: Array<{
    date: string;
    formatted_date: string;
    gross_sales: string;
    net_sales: string;
    checkout_due: string;
    collections: string;
    orders_count: number;
    expenses: string;
    provisional_surplus: string;
  }>;
  payment_methods: Array<{
    method: string;
    amount: string;
    count: number;
    share_pct: number;
  }>;
  top_items: Array<{
    name: string;
    category: string;
    price: string;
    quantity: number;
    revenue: string;
  }>;
  expense_suppliers: Array<{
    supplier_name: string;
    total_cost: string;
    po_count: number;
  }>;
  reservation_analytics: Array<{
    status: string;
    count: number;
    guest_count: number;
  }>;
}

interface PaymentItem {
  id: number;
  bill_id: number;
  dining_session_id: number | null;
  table_id: number | null;
  payment_method: string;
  amount_paid: string;
  transaction_reference: string | null;
  idempotency_key: string | null;
  created_at: string | null;
  is_bill_paid: boolean;
  is_verified_bank_credit: boolean;
  verification_status: string;
  verification_provider: string | null;
  verified_at: string | null;
}

interface ReservationItem {
  id: number;
  customer_name?: string;
  customer_phone?: string;
  guest_count: number;
  reservation_date: string;
  time_slot: string;
  status: string;
  payment_status: string;
  advance_amount: number;
  table_id?: number | null;
  table_name?: string | null;
  floor_number?: number | null;
  booking_id?: string;
  upi_utr?: string | null;
}

interface MenuCategoryItem {
  id: number;
  name: string;
  display_order: number;
  is_active: boolean;
}

interface MenuItemRecord {
  id: number;
  category_id: number;
  name: string;
  description?: string | null;
  price: number;
  tax_rate: number;
  is_available: boolean;
  is_active: boolean;
}

export default function KunalManagerPortal() {
  // Authentication State
  const [token, setToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<
    "overview" | "analytics" | "payments" | "petty_cash" | "reservations" | "menu"
  >("overview");

  // Global Date Filter
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "7d" | "30d" | "custom">("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Sync / Real-time state
  const [lastSynced, setLastSynced] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"connected" | "connecting" | "polling">("connecting");

  // Portal Data States
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [paymentsTotalCount, setPaymentsTotalCount] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsTotalPages, setPaymentsTotalPages] = useState(1);
  const [paymentsFilterTotal, setPaymentsFilterTotal] = useState("0.00");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("");
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);

  // Reservations Data States
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [resSearch, setResSearch] = useState("");
  const [resStatusFilter, setResStatusFilter] = useState("ALL");
  const [verifyingRes, setVerifyingRes] = useState<ReservationItem | null>(null);
  const [enteredUtr, setEnteredUtr] = useState("");
  const [isSubmittingVerify, setIsSubmittingVerify] = useState(false);

  // Menu Data States
  const [categories, setCategories] = useState<MenuCategoryItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRecord[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | "ALL">("ALL");
  const [menuSearch, setMenuSearch] = useState("");
  const [editingItem, setEditingItem] = useState<MenuItemRecord | null>(null);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [isNewCatModalOpen, setIsNewCatModalOpen] = useState(false);

  // Form states for menu edit / add
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formTax, setFormTax] = useState("5.00");
  const [formDesc, setFormDesc] = useState("");
  const [formCatId, setFormCatId] = useState<number>(1);
  const [formAvailable, setFormAvailable] = useState(true);
  const [newCatName, setNewCatName] = useState("");

  // Chart mounting and data preprocessing
  const [isChartMounted, setIsChartMounted] = useState(false);
  useEffect(() => {
    setIsChartMounted(true);
  }, []);

  const chartData = useMemo(() => {
    if (!analytics?.time_series) return [];
    return analytics.time_series.map((d) => ({
      ...d,
      salesNum: parseFloat(d.net_sales || "0"),
      colNum: parseFloat(d.collections || "0"),
    }));
  }, [analytics?.time_series]);

  const hasActivityInPeriod = useMemo(() => {
    return chartData.some((d) => d.salesNum > 0 || d.colNum > 0);
  }, [chartData]);

  // Generic status/action notification toast
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "info") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Helper: Format Rupee Currency
  const formatINR = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return "₹0.00";
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num)) return "₹0.00";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  // Compute Active Date Range Strings in Asia/Kolkata
  const activeDateRange = useMemo(() => {
    const now = new Date();
    const toYMD = (d: Date) => d.toISOString().split("T")[0];

    if (datePreset === "today") {
      const todayStr = toYMD(now);
      return { start: todayStr, end: todayStr };
    }
    if (datePreset === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = toYMD(y);
      return { start: yStr, end: yStr };
    }
    if (datePreset === "7d") {
      const past = new Date(now);
      past.setDate(past.getDate() - 6);
      return { start: toYMD(past), end: toYMD(now) };
    }
    if (datePreset === "30d") {
      const past = new Date(now);
      past.setDate(past.getDate() - 29);
      return { start: toYMD(past), end: toYMD(now) };
    }
    if (datePreset === "custom" && customStart && customEnd) {
      return { start: customStart, end: customEnd };
    }
    const todayStr = toYMD(now);
    return { start: todayStr, end: todayStr };
  }, [datePreset, customStart, customEnd]);

  // Auth Initialization Check (validates 5-hour expiration)
  useEffect(() => {
    const stored = managerSession.getValidToken();
    if (stored) {
      setToken(stored);
    } else {
      setToken(null);
    }
    setIsInitializing(false);

    const onRefreshed = (e: Event) => setToken((e as CustomEvent<string>).detail);
    const onExpired = () => {
      managerSession.clearSession();
      setToken(null);
      showToast("Manager session expired after 5 hours. Please sign in again.", "error");
    };

    window.addEventListener(MANAGER_TOKEN_REFRESHED, onRefreshed);
    window.addEventListener(MANAGER_SESSION_EXPIRED, onExpired);
    return () => {
      window.removeEventListener(MANAGER_TOKEN_REFRESHED, onRefreshed);
      window.removeEventListener(MANAGER_SESSION_EXPIRED, onExpired);
    };
  }, []);

  // Fetch Overview Data
  const fetchOverview = useCallback(async () => {
    if (!token) return;
    try {
      const res = await managerFetch(
        `/api/v1/manager/overview?start=${activeDateRange.start}&end=${activeDateRange.end}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      } else if (res.status === 403) {
        showToast("Access forbidden: Requires Manager or Admin role.", "error");
      }
    } catch (err) {
      console.error("Overview fetch error:", err);
    }
  }, [token, activeDateRange]);

  // Fetch Analytics Data
  const fetchAnalytics = useCallback(async () => {
    if (!token) return;
    try {
      const res = await managerFetch(
        `/api/v1/manager/analytics?start=${activeDateRange.start}&end=${activeDateRange.end}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (err) {
      console.error("Analytics fetch error:", err);
    }
  }, [token, activeDateRange]);

  // Fetch Payments Ledger
  const fetchPayments = useCallback(async () => {
    if (!token) return;
    try {
      let url = `/api/v1/manager/payments?start=${activeDateRange.start}&end=${activeDateRange.end}&page=${paymentsPage}&page_size=50`;
      if (paymentMethodFilter) url += `&method=${encodeURIComponent(paymentMethodFilter)}`;
      if (paymentSearch.trim()) url += `&search=${encodeURIComponent(paymentSearch.trim())}`;

      const res = await managerFetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setPayments(data.items || []);
        setPaymentsTotalCount(data.total_count || 0);
        setPaymentsTotalPages(data.total_pages || 1);
        setPaymentsFilterTotal(data.filtered_total_amount || "0.00");
      }
    } catch (err) {
      console.error("Payments fetch error:", err);
    }
  }, [token, activeDateRange, paymentsPage, paymentMethodFilter, paymentSearch]);

  // Fetch Reservations CRM
  const fetchReservations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await managerFetch(`/api/v1/reservations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReservations(data || []);
      }
    } catch (err) {
      console.error("Reservations fetch error:", err);
    }
  }, [token]);

  // Fetch Menu Data
  const fetchMenu = useCallback(async () => {
    try {
      const [catRes, itemRes] = await Promise.all([
        managerFetch("/api/v1/menu/categories"),
        managerFetch("/api/v1/menu/items"),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (itemRes.ok) setMenuItems(await itemRes.json());
    } catch (err) {
      console.error("Menu fetch error:", err);
    }
  }, []);

  // Master Refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      fetchOverview(),
      fetchAnalytics(),
      fetchPayments(),
      fetchReservations(),
      fetchMenu(),
    ]);
    setLastSynced(new Date());
    setIsRefreshing(false);
  }, [fetchOverview, fetchAnalytics, fetchPayments, fetchReservations, fetchMenu]);

  // Trigger Data Loads on Tab or Filter Changes
  useEffect(() => {
    if (token) {
      handleRefresh();
    }
  }, [token, activeDateRange]);

  // WebSocket Data Sync Listener using Established Project Architecture
  useEffect(() => {
    if (!token) return;
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

    const connectWs = () => {
      setSyncStatus("connecting");
      const wsBase = getWsBase();
      if (!wsBase) return;
      // Directly targets the FastAPI root mount @router.websocket("/ws/{channel}")
      const wsUrl = `${wsBase}/ws/admin`;

      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          setSyncStatus("connected");
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (
              [
                "BILL_PAID",
                "ORDER_CREATED",
                "RESERVATION_UPDATED",
                "MENU_UPDATED",
                "KOT_UPDATE",
              ].includes(msg.type)
            ) {
              if (msg.type === "MENU_UPDATED") fetchMenu();
              else if (msg.type === "RESERVATION_UPDATED") fetchReservations();
              else {
                fetchOverview();
                fetchAnalytics();
                fetchPayments();
              }
              setLastSynced(new Date());
            }
          } catch {
            // Ignore non-json ping/pong
          }
        };
        ws.onerror = () => {
          setSyncStatus("polling");
        };
        ws.onclose = () => {
          setSyncStatus("polling");
          reconnectTimeout = setTimeout(connectWs, 8000);
        };
      } catch {
        setSyncStatus("polling");
      }
    };

    connectWs();
    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [token, fetchOverview, fetchAnalytics, fetchPayments, fetchReservations, fetchMenu]);

  // Handle Login Submission
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await managerFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          password: passwordInput,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoginError(err.detail || "Invalid manager credentials. Please check username & password.");
        return;
      }

      const data = await res.json();
      setToken(data.access_token);
      managerSession.setTokens(data.access_token, data.refresh_token);
      showToast("Welcome to Kunal Manager Portal", "success");
    } catch {
      setLoginError("Could not connect to the API server. Please check your network.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    managerSession.clearSession();
    setToken(null);
    showToast("Signed out successfully.", "info");
  };

  // Actions for Reservations
  const handleReservationCheckin = async (resId: number) => {
    if (!token) return;
    try {
      const res = await managerFetch(`/api/v1/reservations/${resId}/checkin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast(`Guest checked in successfully!`, "success");
        fetchReservations();
        fetchOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Checkin failed", "error");
      }
    } catch {
      showToast("Network error checking in guest", "error");
    }
  };

  const handleReservationStatusUpdate = async (resId: number, newStatus: string) => {
    if (!token) return;
    try {
      const res = await managerFetch(`/api/v1/reservations/${resId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`Reservation status updated to ${newStatus}`, "success");
        fetchReservations();
        fetchOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Status update failed", "error");
      }
    } catch {
      showToast("Network error updating status", "error");
    }
  };

  // Open Advance Verification Dialog
  const openStaffVerifyModal = (r: ReservationItem) => {
    setVerifyingRes(r);
    setEnteredUtr(r.upi_utr || "");
  };

  // Execute Staff Advance Verification with Validated Body
  const submitStaffVerifyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !verifyingRes) return;
    const cleanUtr = enteredUtr.trim().replace(/\s+/g, "");
    if (cleanUtr.length < 4) {
      showToast("Please enter a valid Bank UTR reference (min 4 characters).", "error");
      return;
    }

    setIsSubmittingVerify(true);
    try {
      const res = await managerFetch(`/api/v1/reservations/${verifyingRes.id}/staff-verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ upi_utr: cleanUtr }),
      });
      if (res.ok) {
        showToast(`Advance deposit verified and settled via UTR ${cleanUtr}!`, "success");
        setVerifyingRes(null);
        fetchReservations();
        fetchOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Staff verification failed", "error");
      }
    } catch {
      showToast("Network error verifying payment", "error");
    } finally {
      setIsSubmittingVerify(false);
    }
  };

  // Actions for Menu Management
  const handleToggleMenuAvailability = async (item: MenuItemRecord) => {
    if (!token) return;
    try {
      const res = await managerFetch(`/api/v1/menu/items/${item.id}/availability`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_available: !item.is_available }),
      });
      if (res.ok) {
        showToast(`${item.name} is now ${!item.is_available ? "In Stock" : "Sold Out"}`, "success");
        fetchMenu();
      } else {
        showToast("Failed to toggle availability", "error");
      }
    } catch {
      showToast("Network error updating item", "error");
    }
  };

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const priceNum = parseFloat(formPrice);
    const taxNum = parseFloat(formTax);
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast("Please enter a valid price.", "error");
      return;
    }

    try {
      if (editingItem) {
        const res = await managerFetch(`/api/v1/menu/items/${editingItem.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: formName.trim(),
            category_id: formCatId,
            price: priceNum,
            tax_rate: taxNum,
            description: formDesc.trim() || null,
            is_available: formAvailable,
          }),
        });
        if (res.ok) {
          showToast(`Updated ${formName} successfully!`, "success");
          setEditingItem(null);
          fetchMenu();
        } else {
          showToast("Failed to update menu item", "error");
        }
      } else {
        const res = await managerFetch(`/api/v1/menu/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: formName.trim(),
            category_id: formCatId,
            price: priceNum,
            tax_rate: taxNum,
            description: formDesc.trim() || null,
            is_available: formAvailable,
          }),
        });
        if (res.ok) {
          showToast(`Created ${formName} successfully!`, "success");
          setIsNewItemModalOpen(false);
          fetchMenu();
        } else {
          showToast("Failed to create menu item", "error");
        }
      }
    } catch {
      showToast("Network error saving menu item", "error");
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newCatName.trim()) return;
    try {
      const res = await managerFetch("/api/v1/menu/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newCatName.trim(),
          display_order: categories.length + 1,
        }),
      });
      if (res.ok) {
        showToast(`Category '${newCatName}' created!`, "success");
        setNewCatName("");
        setIsNewCatModalOpen(false);
        fetchMenu();
      } else {
        showToast("Failed to create category", "error");
      }
    } catch {
      showToast("Network error creating category", "error");
    }
  };

  // Filtered reservations list
  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (resStatusFilter !== "ALL" && (r.status || "").toUpperCase() !== resStatusFilter) {
        return false;
      }
      if (resSearch.trim()) {
        const q = resSearch.toLowerCase();
        const bId = (r.booking_id || formatBookingId(r.customer_name, r.customer_phone, r.id)).toLowerCase();
        const name = (r.customer_name || "").toLowerCase();
        const phone = (r.customer_phone || "").toLowerCase();
        if (!bId.includes(q) && !name.includes(q) && !phone.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [reservations, resStatusFilter, resSearch]);

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((i) => {
      if (selectedCategory !== "ALL" && i.category_id !== selectedCategory) {
        return false;
      }
      if (menuSearch.trim()) {
        const q = menuSearch.toLowerCase();
        return i.name.toLowerCase().includes(q) || (i.description || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [menuItems, selectedCategory, menuSearch]);

  // Open Edit Item Modal
  const openEditModal = (item: MenuItemRecord) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormPrice(String(item.price));
    setFormTax(String(item.tax_rate));
    setFormDesc(item.description || "");
    setFormCatId(item.category_id);
    setFormAvailable(item.is_available);
  };

  // Open Add Item Modal
  const openAddModal = () => {
    setEditingItem(null);
    setFormName("");
    setFormPrice("");
    setFormTax("5.00");
    setFormDesc("");
    setFormCatId(categories[0]?.id || 1);
    setFormAvailable(true);
    setIsNewItemModalOpen(true);
  };

  // -------------------------------------------------------------
  // RENDERING: 1. Initial Loading
  // -------------------------------------------------------------
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#2D6A4F] border-t-transparent rounded-full animate-spin" />
          <p className="font-serif italic text-[#133826] text-base">Initializing Kunal Manager Portal...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDERING: 2. Authentication Login Screen
  // -------------------------------------------------------------
  if (!token) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col justify-between font-sans selection:bg-[#52B788]/20">
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <Card className="w-full max-w-md bg-white rounded-3xl border-[#E2DACF] p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-44 h-44 bg-[#EBF5EE] rounded-full blur-3xl -z-0 pointer-events-none" />

            <div className="text-center relative z-10 mb-8">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl overflow-hidden border border-[#E2DACF] shadow-xs bg-white p-1">
                <Image
                  src="/jaadoo_logo.jpg"
                  alt="Jaadoo Pizza Project"
                  width={80}
                  height={80}
                  className="w-full h-full object-cover rounded-xl"
                  priority
                />
              </div>
              <Badge variant="success" className="bg-[#EBF5EE] text-[#2D6A4F] border-[#B7E4C7] font-sans font-bold tracking-[0.2em] uppercase text-[10px] mb-2">
                Official Staff Access
              </Badge>
              <h1 className="text-3xl font-serif font-bold text-[#133826] mt-1">
                Kunal Manager Portal
              </h1>
              <p className="text-xs text-[#5A6A5E] mt-2 font-sans">
                Financial Operations · Business Analytics · Reservations CRM
              </p>
            </div>

            {loginError && (
              <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4 relative z-10">
              <div>
                <label className="block text-xs font-semibold text-[#133826] mb-1.5 uppercase tracking-wider font-sans">
                  Username / Staff ID
                </label>
                <Input
                  type="text"
                  required
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="e.g. kunal"
                  className="h-11 rounded-xl border-[#D7CDBF] bg-[#FAF8F5] text-[#133826] placeholder:text-stone-400 focus-visible:ring-[#2D6A4F] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#133826] mb-1.5 uppercase tracking-wider font-sans">
                  Password
                </label>
                <Input
                  type="password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 rounded-xl border-[#D7CDBF] bg-[#FAF8F5] text-[#133826] placeholder:text-stone-400 focus-visible:ring-[#2D6A4F] text-sm"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoggingIn}
                className="w-full mt-2 h-12 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-sans font-bold text-sm tracking-wide rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                {isLoggingIn ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying Permissions...</span>
                  </>
                ) : (
                  <span>Access Manager Portal</span>
                )}
              </Button>
            </form>

            <Separator className="mt-8 mb-4 bg-[#EAE3D9]" />
            <div className="text-center text-[11px] text-[#718074] font-sans">
              Protected Management System · Café Piza / Jaadoo Pizza Project
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDERING: 3. Authenticated Manager Portal Shell
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141E16] font-sans flex flex-col selection:bg-[#52B788]/25">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-medium flex items-center gap-3 transition-all animate-in fade-in slide-in-from-bottom-3 ${
            toastMessage.type === "success"
              ? "bg-[#1B4332] text-white border-[#52B788]"
              : toastMessage.type === "error"
              ? "bg-red-800 text-white border-red-500"
              : "bg-[#263228] text-white border-stone-600"
          }`}
        >
          {toastMessage.type === "success" && <CheckCircle2 className="w-4 h-4 text-[#52B788]" />}
          {toastMessage.type === "error" && <AlertCircle className="w-4 h-4 text-red-300" />}
          {toastMessage.type === "info" && <Info className="w-4 h-4 text-stone-300" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* TOP HEADER: Brand Logo + Identity + Navigation Controls */}
      <header className="sticky top-0 z-40 bg-[#FFFDF9] border-b border-[#E6DCce] shadow-xs px-4 sm:px-6 py-3.5">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Left: Manager Profile Chip & Sync Status */}
          <div className="flex items-center justify-start order-2 md:order-1 min-w-0">
            <div className="flex items-center gap-2.5 bg-[#FAF8F5] py-1 px-3 rounded-2xl border border-[#E2DACF] shadow-2xs">
              <div className="w-8 h-8 rounded-full bg-[#1B4332] text-white flex items-center justify-center font-bold text-xs ring-2 ring-[#52B788]/20 shrink-0">
                K
              </div>
              <div className="text-left hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <span className="font-sans font-bold text-xs text-[#133826] leading-tight">
                    Kunal
                  </span>
                  <span className="text-[10px] text-[#718074] font-medium">(Store Manager)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[#5A6A5E] font-sans mt-0.5">
                  <span className="relative flex h-2 w-2">
                    {syncStatus === "connected" && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${
                        syncStatus === "connected"
                          ? "bg-emerald-500"
                          : syncStatus === "connecting"
                          ? "bg-amber-400"
                          : "bg-amber-500"
                      }`}
                    />
                  </span>
                  <span className="tabular-nums">
                    {syncStatus === "connected" ? "Live Connected" : syncStatus === "connecting" ? "Syncing..." : "Periodic Polling"} · {lastSynced.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Center: Editorial Brand Logo & Jaadoo Pizza Project Title */}
          <div className="flex items-center justify-center gap-3.5 order-1 md:order-2 min-w-0">
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
                  Kunal Portal
                </span>
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center justify-center md:justify-end gap-2.5 sm:gap-3 order-3">

            {/* Refresh Button */}
            <Button
              variant="secondary"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#B85B43]" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            {/* Open POS Link */}
            <Link href="/pos" target="_blank" className="inline-flex">
              <Button variant="secondary" className="text-[#B85B43] border-[#B85B43]/30">
                <Store className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Open POS</span>
                <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
              </Button>
            </Link>

            {/* Logout Button */}
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        {/* NAVIGATION BAR & DATE FILTER STRIP */}
        <div className="bg-[#FAF8F5] border-t border-[#EAE3D9] px-4 sm:px-6 lg:px-8 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
            {/* 6 Core Tabs in Segmented Capsule Container */}
            <div className="bg-[#F0EBE1]/90 p-1 rounded-2xl border border-[#DFD5C6] shadow-2xs overflow-x-auto scrollbar-none shrink-0">
              <TabsList className="bg-transparent border-none p-0 flex items-center gap-1 h-auto">
                {[
                  { id: "overview", label: "Overview", fullLabel: "Overview", icon: Layers },
                  { id: "analytics", label: "Analytics", fullLabel: "Financial Analytics", icon: TrendingUp },
                  { id: "payments", label: "Payments", fullLabel: "Payments & Collections", icon: CreditCard },
                  { id: "petty_cash", label: "Petty Cash", fullLabel: "Petty Cash", icon: Wallet },
                  { id: "reservations", label: "Reservations", fullLabel: "Reservations CRM", icon: CalendarDays },
                  { id: "menu", label: "Menu", fullLabel: "Menu Management", icon: UtensilsCrossed },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      active={isActive}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs sm:text-sm font-sans font-semibold transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                        isActive
                          ? "bg-[#1B4332] text-white shadow-xs"
                          : "text-[#526357] hover:text-[#133826] hover:bg-white/60"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="hidden 2xl:inline">{tab.fullLabel}</span>
                      <span className="inline 2xl:hidden">{tab.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            {/* Date Range Selector Strip */}
            <div className="flex items-center gap-1.5 self-end xl:self-auto bg-white p-1 rounded-2xl border border-[#DFD5C6] shadow-2xs shrink-0">
              <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#718074] px-2 hidden sm:inline">
                Period:
              </span>
              {(["today", "yesterday", "7d", "30d", "custom"] as const).map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={datePreset === preset ? "default" : "ghost"}
                  onClick={() => setDatePreset(preset)}
                  className={`h-7 px-2.5 text-xs font-sans font-semibold rounded-xl capitalize transition-colors cursor-pointer ${
                    datePreset === preset
                      ? "bg-[#2D6A4F] text-white hover:bg-[#2D6A4F] shadow-xs"
                      : "text-[#5A6A5E] hover:text-[#133826] hover:bg-stone-100"
                  }`}
                >
                  {preset === "7d" ? "7 Days" : preset === "30d" ? "30 Days" : preset}
                </Button>
              ))}

              {datePreset === "custom" && (
                <div className="flex items-center gap-1.5 pl-2 border-l border-stone-200">
                  <Input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="h-7 text-xs px-2 py-0.5 rounded-lg border-stone-300 bg-stone-50 w-auto font-sans tabular-nums"
                  />
                  <span className="text-xs text-stone-400 font-sans">to</span>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="h-7 text-xs px-2 py-0.5 rounded-lg border-stone-300 bg-stone-50 w-auto font-sans tabular-nums"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ============================================================= */}
        {/* TAB 1: OVERVIEW — EXECUTIVE FINANCIAL DASHBOARD               */}
        {/* ============================================================= */}
        {activeTab === "overview" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Period Badge Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-[#E2DACF] shadow-2xs">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 text-[#2D6A4F]" />
                <span className="text-xs text-[#5A6A5E]">Active Business Period (IST):</span>
                <span className="text-xs font-bold text-[#133826]">
                  {activeDateRange.start} {activeDateRange.start !== activeDateRange.end ? `to ${activeDateRange.end}` : "(Single Day)"}
                </span>
                {overview?.revenue?.revenue_growth_pct !== null && overview?.revenue?.revenue_growth_pct !== undefined && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      overview.revenue.revenue_growth_pct >= 0
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : "bg-amber-50 text-amber-800 border border-amber-200"
                    }`}
                  >
                    {overview.revenue.revenue_growth_pct >= 0 ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {overview.revenue.revenue_growth_pct > 0 ? "+" : ""}
                    {overview.revenue.revenue_growth_pct}% vs Prior Period
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#718074]">
                Authoritative calculation engine · Half-open UTC timestamp bounds
              </div>
            </div>

            {/* 7 TOP-LEVEL METRIC CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Dining Sales */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Total Dining Sales</span>
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-800">
                      <Receipt className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl sm:text-3xl font-sans font-bold tabular-nums tracking-tight text-[#133826]">
                      {formatINR(overview?.revenue?.total_dining_consumption || overview?.revenue?.net_sales)}
                    </div>
                    <div className="mt-2 text-[11px] text-[#718074] space-y-1 font-sans">
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Gross Food & Beverage:</span>
                        <span className="font-semibold tabular-nums text-stone-700">{formatINR(overview?.revenue?.gross_subtotal)}</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Discounts Applied:</span>
                        <span className="font-semibold tabular-nums text-amber-700">-{formatINR(overview?.revenue?.discounts)}</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>GST Tax (5%):</span>
                        <span className="font-semibold tabular-nums text-stone-700">+{formatINR(overview?.revenue?.taxes)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-800 font-semibold pt-0.5">
                        <span>Advance Credits Applied:</span>
                        <span className="tabular-nums">-{formatINR(overview?.revenue?.reservation_credits_applied)}</span>
                      </div>
                      <div className="flex justify-between text-[#133826] font-bold pt-1 border-t border-stone-200">
                        <span>Net POS Checkout Due:</span>
                        <span className="tabular-nums">{formatINR(overview?.revenue?.net_pos_checkout_due)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: UPI Collections */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Verified UPI</span>
                    <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-800">
                      <CreditCard className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl sm:text-3xl font-sans font-bold tabular-nums tracking-tight text-[#133826]">
                      {formatINR(overview?.upi_reconciliation?.verified_settled_amount)}
                    </div>
                    <div className="mt-2 text-[11px] text-[#718074] space-y-1 font-sans">
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Bank Settled Credits:</span>
                        <span className="font-semibold tabular-nums text-emerald-700">
                          {overview?.upi_reconciliation?.verified_settled_count || 0} txn
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Requires Review:</span>
                        <span className="font-semibold tabular-nums text-amber-700">
                          {formatINR(overview?.upi_reconciliation?.review_required_amount)} ({overview?.upi_reconciliation?.review_required_count || 0})
                        </span>
                      </div>
                      <div className="flex justify-between pt-0.5">
                        <span>POS Ledger UPI:</span>
                        <span className="font-semibold tabular-nums text-stone-700">{formatINR(overview?.collections?.by_method?.UPI)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Total Recorded Purchases / Expenses */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Recorded Purchases</span>
                    <div className="w-8 h-8 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-700">
                      <DollarSign className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl sm:text-3xl font-sans font-bold tabular-nums tracking-tight text-[#133826]">
                      {formatINR(overview?.expenses?.received_expenses)}
                    </div>
                    <div className="mt-2 text-[11px] text-[#718074] space-y-1 font-sans">
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Received Invoices:</span>
                        <span className="font-semibold tabular-nums text-stone-700">{overview?.expenses?.received_count || 0} orders</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Committed / POs:</span>
                        <span className="font-semibold tabular-nums text-stone-600">
                          {formatINR(overview?.expenses?.ordered_commitments)} ({overview?.expenses?.ordered_count || 0})
                        </span>
                      </div>
                      <div className="flex justify-between pt-0.5">
                        <span>Source:</span>
                        <span className="font-semibold text-stone-700">Inventory POs</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 4: Profit & Loss (Provisional) */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <div className="flex items-center gap-1.5">
                      <span>Surplus</span>
                      <Badge variant="warning" className="text-[9px] font-extrabold uppercase px-1 py-0 font-sans">
                        Provisional
                      </Badge>
                    </div>
                    <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-800">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl sm:text-3xl font-sans font-bold tabular-nums tracking-tight text-[#133826]">
                      {formatINR(overview?.profit_and_loss?.provisional_surplus)}
                    </div>
                    <div className="mt-2 text-[11px] text-[#718074] space-y-1 font-sans">
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Dining Sales:</span>
                        <span className="font-semibold tabular-nums text-stone-700">{formatINR(overview?.profit_and_loss?.net_sales)}</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Less Purchases:</span>
                        <span className="font-semibold tabular-nums text-stone-700">-{formatINR(overview?.expenses?.received_expenses)}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-amber-700 font-medium italic pt-0.5">
                        <span>Recipe COGS:</span>
                        <span>Linkage pending</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 5: Petty Cash Status */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Petty Cash</span>
                    <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-800">
                      <Wallet className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="inline-block">
                      <Badge variant="warning" className="text-xs font-bold py-1 px-2.5">
                        Not Configured
                      </Badge>
                    </div>
                    <p className="mt-2 text-[11px] text-[#718074] leading-snug font-sans">
                      A dedicated petty cash ledger does not currently exist in the database. Reported honestly without fabricated numbers.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Card 6: Outstanding Amounts */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Outstanding</span>
                    <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-800">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-2xl sm:text-3xl font-sans font-bold tabular-nums tracking-tight text-[#133826]">
                      {formatINR(overview?.outstanding?.amount)}
                    </div>
                    <div className="mt-2 text-[11px] text-[#718074] space-y-1 font-sans">
                      <div className="flex justify-between py-0.5 border-b border-stone-100">
                        <span>Unsettled Bills:</span>
                        <span className="font-semibold tabular-nums text-stone-700">{overview?.outstanding?.count || 0} bills</span>
                      </div>
                      <div className="flex justify-between pt-0.5">
                        <span>Status:</span>
                        <span className="font-semibold text-amber-700">Awaiting Checkout</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 7: Reservations & Sales Velocity */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs relative overflow-hidden sm:col-span-2 group hover:border-[#1B4332]/40 hover:shadow-md transition-all duration-200">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-xs font-sans font-bold uppercase tracking-wider text-[#5A6A5E]">
                    <span>Reservations & Order Velocity</span>
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-800">
                      <CalendarDays className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 font-sans">
                    <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE3D9]">
                      <span className="text-[10px] text-[#718074] block">Bookings</span>
                      <span className="text-xl font-sans font-bold tabular-nums text-[#133826]">
                        {overview?.reservations?.total_count || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE3D9]">
                      <span className="text-[10px] text-[#718074] block">Advance Deposit</span>
                      <span className="text-xl font-sans font-bold tabular-nums text-emerald-800">
                        {formatINR(overview?.reservations?.advance_collected)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE3D9]">
                      <span className="text-[10px] text-[#718074] block">Settled Bills</span>
                      <span className="text-xl font-sans font-bold tabular-nums text-[#133826]">
                        {overview?.revenue?.completed_bills_count || 0}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#EAE3D9]">
                      <span className="text-[10px] text-[#718074] block">Avg Ticket</span>
                      <span className="text-xl font-sans font-bold tabular-nums text-[#133826]">
                        {formatINR(overview?.revenue?.aov)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* PAYMENT METHOD BREAKDOWN STRIP WITH PROGRESS BARS */}
            <Card className="bg-white rounded-2xl p-6 border-[#E2DACF] shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-serif font-bold text-base text-[#133826]">
                    Collections Breakdown by Payment Method
                  </h3>
                  <p className="text-xs text-[#5A6A5E] mt-0.5">
                    Proportion of realized collections deposited through each payment channel
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#718074] block">Total Collections</span>
                  <span className="text-base font-sans font-bold tabular-nums text-[#133826]">
                    {formatINR(overview?.collections?.total_funds_collected)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {(() => {
                  const totalCollectedNum = parseFloat(overview?.collections?.total_funds_collected || "0");
                  return [
                    {
                      key: "UPI",
                      label: "UPI Collections",
                      colorBorder: "border-l-4 border-l-emerald-600 bg-emerald-50/20",
                      progressColor: "bg-emerald-600",
                    },
                    {
                      key: "CASH",
                      label: "Cash Register",
                      colorBorder: "border-l-4 border-l-amber-600 bg-amber-50/20",
                      progressColor: "bg-amber-600",
                    },
                    {
                      key: "CARD",
                      label: "Card POS Swipe",
                      colorBorder: "border-l-4 border-l-blue-600 bg-blue-50/20",
                      progressColor: "bg-blue-600",
                    },
                    {
                      key: "OTHER",
                      label: "Other Channels",
                      colorBorder: "border-l-4 border-l-stone-500 bg-stone-50/20",
                      progressColor: "bg-stone-500",
                    },
                  ].map((item) => {
                    const amt = overview?.collections?.by_method?.[item.key] || "0.00";
                    const count = overview?.collections?.counts_by_method?.[item.key] || 0;
                    const amtNum = parseFloat(amt);
                    const sharePct = totalCollectedNum > 0 ? Math.round((amtNum / totalCollectedNum) * 100) : 0;
                    return (
                      <div key={item.key} className={`p-4 rounded-xl border border-[#EAE3D9] ${item.colorBorder}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-sans font-semibold text-[#5A6A5E]">{item.label}</span>
                          <span className="text-[11px] font-sans font-bold tabular-nums text-stone-600">{sharePct}%</span>
                        </div>
                        <span className="text-xl font-sans font-bold tabular-nums text-[#133826] block mt-1">
                          {formatINR(amt)}
                        </span>
                        <Progress value={sharePct} className="h-1.5 mt-2 bg-stone-200/60" indicatorClassName={item.progressColor} />
                        <span className="text-[11px] font-sans text-[#718074] mt-2 block tabular-nums">
                          {count} completed transactions
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </Card>

            {/* AUDIT & DISCLOSURE FOOTNOTE */}
            <div className="p-4 rounded-xl bg-[#EBF5EE] border border-[#B7E4C7] text-xs text-[#1B4332] flex items-start gap-3">
              <Info className="w-5 h-5 shrink-0 text-[#2D6A4F] mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold">Authoritative Data Integrity & Accounting Notes:</span>
                <p className="text-[11px] leading-relaxed text-[#2D6A4F]">
                  Total Dining Sales reflects served orders (e.g. ₹1,200). When an advance reservation deposit is credited (e.g. ₹500), Net POS Checkout Due is the remaining balance payable (₹700). Customer-entered raw references are not counted as confirmed collections until settled in bank credit records. Operating surplus reflects recorded supplier receipts; dish-level recipe COGS is pending complete recipe-inventory linking.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: FINANCIAL ANALYTICS & CHARTS                           */}
        {/* ============================================================= */}
        {activeTab === "analytics" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Daily Revenue Time-Series Trend */}
            <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-2">
                <div>
                  <CardTitle className="font-serif font-bold text-lg text-[#133826]">
                    Revenue & Collections Daily Trend
                  </CardTitle>
                  <CardDescription className="text-xs text-[#5A6A5E] mt-1">
                    Daily progression of Total Dining Sales and Verified Collections in Asia/Kolkata
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-[#1B4332]" />
                    <span className="text-[#133826]">Dining Sales</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-[#52B788]" />
                    <span className="text-[#133826]">Collections</span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-2">
                {isChartMounted && chartData.length > 0 ? (
                  <div className="space-y-3">
                    <div className="w-full h-64 pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={chartData}
                          margin={{ top: 12, right: 12, left: -10, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAE3D9" />
                          <XAxis
                            dataKey="formatted_date"
                            stroke="#718074"
                            fontSize={11}
                            tickLine={false}
                            axisLine={{ stroke: "#E2DACF" }}
                            dy={6}
                          />
                          <YAxis
                            stroke="#718074"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) =>
                              val >= 1000
                                ? `₹${(val / 1000).toFixed(0)}k`
                                : `₹${val}`
                            }
                            dx={-4}
                          />
                          <RechartsTooltip
                            cursor={{ fill: "#FAF8F5", opacity: 0.8 }}
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-[#133826] text-white p-3 rounded-xl shadow-xl border border-[#2D6A4F] text-xs space-y-1.5 min-w-[170px]">
                                    <div className="font-bold border-b border-white/10 pb-1 text-[#FAF8F5]">
                                      {data.formatted_date}
                                    </div>
                                    <div className="flex justify-between items-center text-[#B7E4C7]">
                                      <span>Dining Sales:</span>
                                      <span className="font-sans font-bold tabular-nums text-white">
                                        {formatINR(data.net_sales)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center text-[#74C69D]">
                                      <span>Collections:</span>
                                      <span className="font-sans font-bold tabular-nums text-white">
                                        {formatINR(data.collections)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Bar
                            dataKey="salesNum"
                            name="Dining Sales"
                            fill="#1B4332"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={36}
                          />
                          <Bar
                            dataKey="colNum"
                            name="Collections"
                            fill="#52B788"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={36}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {!hasActivityInPeriod && (
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#FAF8F5] border border-[#E2DACF] text-xs text-[#5A6A5E]">
                        <div className="flex items-center gap-2">
                          <Info className="w-4 h-4 text-[#2D6A4F] shrink-0" />
                          <span>
                            No dining sales or collections recorded yet for this period. As orders are completed in POS, bars populate in real-time.
                          </span>
                        </div>
                        {datePreset === "today" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDatePreset("7d")}
                            className="text-xs h-7 border-[#D7CDBF] text-[#133826] hover:bg-white shrink-0 ml-auto"
                          >
                            View Past 7 Days
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-16 text-center text-sm text-[#718074]">
                    Loading sales trend analytics...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 2-Column: Top Items & Payment Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Selling Menu Items */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="font-serif font-bold text-base text-[#133826]">
                    Top-Selling Menu Items
                  </CardTitle>
                  <CardDescription className="text-xs text-[#5A6A5E]">
                    Ranked by actual completed order revenue
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {analytics?.top_items && analytics.top_items.length > 0 ? (
                    <div className="divide-y divide-[#EAE3D9]">
                      {analytics.top_items.map((item, idx) => (
                        <div key={item.name} className="py-3 flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-[#EBF5EE] text-[#2D6A4F] font-sans font-bold tabular-nums text-[11px] flex items-center justify-center shrink-0 border border-[#B7E4C7]">
                              {idx + 1}
                            </span>
                            <div className="truncate">
                              <span className="font-bold text-[#133826] block truncate">{item.name}</span>
                              <span className="text-[10px] text-[#718074]">
                                {item.category} · <span className="font-sans font-semibold tabular-nums">{formatINR(item.price)}</span>
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-sans font-bold tabular-nums text-[#133826] block">
                              {formatINR(item.revenue)}
                            </span>
                            <span className="text-[10px] text-[#718074]">
                              <span className="font-sans font-semibold tabular-nums">{item.quantity}</span> orders
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 px-4 text-center flex flex-col items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-[#FAF8F5] border border-[#E2DACF] flex items-center justify-center text-[#718074] mb-2.5">
                        <UtensilsCrossed className="w-5 h-5 text-[#2D6A4F]" />
                      </div>
                      <span className="font-bold text-xs text-[#133826]">No Menu Orders in this Period</span>
                      <p className="text-[11px] text-[#718074] max-w-xs mt-1">
                        Dishes ordered through POS or Table QR will automatically rank here with real revenue.
                      </p>
                      {datePreset === "today" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDatePreset("7d")}
                          className="mt-3 text-xs h-7 border-[#D7CDBF] text-[#133826]"
                        >
                          Check 7-Day Velocity
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Expense Breakdown by Supplier */}
              <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="font-serif font-bold text-base text-[#133826]">
                    Supplier Purchase Expenses
                  </CardTitle>
                  <CardDescription className="text-xs text-[#5A6A5E]">
                    Received purchase orders and supplier distributions
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {analytics?.expense_suppliers && analytics.expense_suppliers.length > 0 ? (
                    <div className="divide-y divide-[#EAE3D9]">
                      {analytics.expense_suppliers.map((supp) => (
                        <div key={supp.supplier_name} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-[#133826] block">{supp.supplier_name}</span>
                            <span className="text-[10px] text-[#718074]">
                              <span className="font-sans font-semibold tabular-nums">{supp.po_count}</span> invoices processed
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-sans font-bold tabular-nums text-[#133826] block">
                              {formatINR(supp.total_cost)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 px-4 text-center flex flex-col items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-[#FAF8F5] border border-[#E2DACF] flex items-center justify-center text-[#718074] mb-2.5">
                        <Receipt className="w-5 h-5 text-[#2D6A4F]" />
                      </div>
                      <span className="font-bold text-xs text-[#133826]">No Supplier Purchases in this Period</span>
                      <p className="text-[11px] text-[#718074] max-w-xs mt-1">
                        Procurement orders marked as RECEIVED will be categorized and summarized here.
                      </p>
                      {datePreset === "today" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDatePreset("30d")}
                          className="mt-3 text-xs h-7 border-[#D7CDBF] text-[#133826]"
                        >
                          Check 30-Day Expenses
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 3: PAYMENTS & COLLECTIONS AUDIT                           */}
        {/* ============================================================= */}
        {activeTab === "payments" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Filter & Search Bar */}
            <Card className="bg-white rounded-2xl p-4 border-[#E2DACF] shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#718074] z-10" />
                    <Input
                      type="text"
                      value={paymentSearch}
                      onChange={(e) => setPaymentSearch(e.target.value)}
                      placeholder="Search by UTR, Bill ID, Reference..."
                      className="pl-9 bg-[#FAF8F5] border-[#D7CDBF] text-xs font-sans text-[#133826] placeholder:text-stone-400 h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                    />
                  </div>

                  <select
                    value={paymentMethodFilter}
                    onChange={(e) => setPaymentMethodFilter(e.target.value)}
                    className="h-9 px-3 rounded-xl border border-[#D7CDBF] bg-[#FAF8F5] text-xs font-semibold text-[#133826] focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  >
                    <option value="">All Payment Methods</option>
                    <option value="UPI">UPI</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>

                <Badge variant="success" className="px-3.5 py-1.5 text-xs font-medium rounded-xl gap-2 bg-[#EBF5EE] text-[#2D6A4F] border-[#B7E4C7]">
                  <span>Filtered Ledger Total:</span>
                  <span className="font-sans font-bold tabular-nums text-[#133826]">{formatINR(paymentsFilterTotal)}</span>
                  <span className="text-[10px] text-[#5A6A5E] font-sans tabular-nums">({paymentsTotalCount} txns)</span>
                </Badge>
              </div>
            </Card>

            {/* Payments Audit Table */}
            <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs overflow-hidden">
              <Table>
                <TableHeader className="bg-[#FAF8F5] border-b border-[#EAE3D9]">
                  <TableRow>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Txn ID / Bill</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Method</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Amount</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Reference / UTR</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Audit Status</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Timestamp (IST)</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-[#EAE3D9]">
                  {payments.length > 0 ? (
                    payments.map((p) => {
                      const isVerified = p.is_verified_bank_credit || p.verification_status === "VERIFIED_CASH";
                      return (
                        <TableRow key={p.id} className="hover:bg-[#FAF8F5]/80 transition-colors">
                          <TableCell className="py-3.5 px-4 font-sans font-medium">
                            <span className="font-bold tabular-nums text-[#133826]">#{p.id}</span>
                            <span className="text-[11px] text-[#718074] block font-sans tabular-nums">Bill #{p.bill_id}</span>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-semibold text-[#133826]">
                            {p.payment_method}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-sans font-bold tabular-nums text-sm text-[#133826]">
                            {formatINR(p.amount_paid)}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-mono tabular-nums text-[11px] text-stone-600">
                            {p.transaction_reference || "—"}
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <Badge
                              variant={
                                p.is_verified_bank_credit
                                  ? "success"
                                  : p.verification_status === "VERIFIED_CASH"
                                  ? "warning"
                                  : "secondary"
                              }
                              className="gap-1 font-bold tracking-wider"
                            >
                              {isVerified ? (
                                <Check className="w-3 h-3 text-emerald-700" />
                              ) : (
                                <AlertCircle className="w-3 h-3 text-amber-600" />
                              )}
                              {p.verification_status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-[11px] font-sans tabular-nums text-[#718074]">
                            {p.created_at ? new Date(p.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedPayment(p)}
                              className="h-7 w-7 p-0 rounded-lg border-[#D7CDBF] bg-white hover:bg-stone-50 text-[#133826]"
                              title="View Audit Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-stone-500">
                        No transactions found matching the selected filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {paymentsTotalPages > 1 && (
                <div className="p-4 border-t border-[#EAE3D9] flex items-center justify-between text-xs">
                  <span className="text-[#718074] font-sans tabular-nums">
                    Page {paymentsPage} of {paymentsTotalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={paymentsPage <= 1}
                      onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
                      className="border-[#D7CDBF] bg-white text-xs"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={paymentsPage >= paymentsTotalPages}
                      onClick={() => setPaymentsPage((p) => Math.min(paymentsTotalPages, p + 1))}
                      className="border-[#D7CDBF] bg-white text-xs"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Payment Audit Detail Modal */}
            {selectedPayment && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
                <Card className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-[#E2DACF] animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="font-serif font-bold text-lg text-[#133826]">
                      Payment Audit Details
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPayment(null)}
                      className="h-7 w-7 p-0 rounded-lg text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Transaction ID:</span>
                      <span className="font-sans font-bold tabular-nums text-[#133826]">#{selectedPayment.id}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Bill Reference:</span>
                      <span className="font-sans font-bold tabular-nums text-[#133826]">Bill #{selectedPayment.bill_id}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Payment Method:</span>
                      <span className="font-bold text-[#133826]">{selectedPayment.payment_method}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Amount Paid:</span>
                      <span className="font-sans font-bold tabular-nums text-base text-[#133826]">
                        {formatINR(selectedPayment.amount_paid)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Reference / UTR:</span>
                      <span className="font-mono tabular-nums text-stone-700">{selectedPayment.transaction_reference || "None"}</span>
                    </div>
                    <div className="flex justify-between py-1.5 border-b border-stone-100">
                      <span className="text-[#718074]">Verification Status:</span>
                      <span className="font-bold text-[#2D6A4F]">{selectedPayment.verification_status}</span>
                    </div>
                    {selectedPayment.verification_provider && (
                      <div className="flex justify-between py-1.5 border-b border-stone-100">
                        <span className="text-[#718074]">Bank Source:</span>
                        <span className="font-mono text-stone-700">{selectedPayment.verification_provider}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5">
                      <span className="text-[#718074]">Recorded Timestamp:</span>
                      <span className="text-stone-700 font-sans tabular-nums">
                        {selectedPayment.created_at ? new Date(selectedPayment.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
                      </span>
                    </div>
                  </div>

                  <Button
                    onClick={() => setSelectedPayment(null)}
                    className="w-full mt-6 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-bold text-xs rounded-xl"
                  >
                    Close Inspection
                  </Button>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 4: PETTY CASH MANAGEMENT (HONEST AUDIT STATE)             */}
        {/* ============================================================= */}
        {activeTab === "petty_cash" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <Card className="bg-white rounded-2xl p-8 border-[#E2DACF] shadow-xs max-w-3xl mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-[#EBF5EE] text-[#2D6A4F] flex items-center justify-center mb-5">
                <Wallet className="w-7 h-7" />
              </div>
              <CardTitle className="font-serif font-bold text-2xl text-[#133826]">
                Petty Cash Ledger Architecture
              </CardTitle>
              <CardDescription className="text-sm text-[#5A6A5E] mt-2 leading-relaxed">
                As required by Section 7 of the project specification: We do not invent an artificial cash balance from unrelated payment records.
              </CardDescription>

              <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <Badge variant="warning" className="text-xs py-0.5 px-2 font-bold">
                    Active Ledger Status: Not Configured in Database
                  </Badge>
                  <p className="text-amber-800 leading-relaxed text-[11px] pt-1">
                    The existing database schema does not currently include a dedicated petty cash transaction table. Per our development guardrails, schema migrations require explicit owner approval.
                  </p>
                </div>
              </div>

              {/* Proposed Architecture */}
              <div className="mt-8 border-t border-[#EAE3D9] pt-6">
                <h4 className="font-serif font-bold text-base text-[#133826] mb-3">
                  Proposed Production Ledger Schema
                </h4>
                <div className="bg-[#FAF8F5] p-4 rounded-xl border border-[#D7CDBF] font-mono text-xs text-stone-800 space-y-1.5 overflow-x-auto">
                  <div><strong>Table:</strong> petty_cash_transactions</div>
                  <div>- id: Integer (Primary Key)</div>
                  <div>- transaction_type: &apos;INFLOW&apos; | &apos;OUTFLOW&apos; | &apos;ADJUSTMENT&apos;</div>
                  <div>- amount: Numeric(10, 2) [Decimal-safe]</div>
                  <div>- category: &apos;Dairy&apos;, &apos;Vegetables&apos;, &apos;Gas&apos;, &apos;Ice&apos;, &apos;Cleaning&apos;, &apos;Misc&apos;</div>
                  <div>- description: String(255)</div>
                  <div>- reference_number: String(100) (Nullable)</div>
                  <div>- performed_by_user_id: ForeignKey(&apos;users.id&apos;)</div>
                  <div>- created_at: DateTime (UTC timestamp)</div>
                </div>
                <p className="text-[11px] text-[#718074] mt-3 italic">
                  Once authorized, this minimal ledger will enable physical drawer reconciliation, opening/closing counts, and daily petty expense logging without disrupting sales accounting.
                </p>
              </div>
            </Card>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 5: RESERVATIONS CRM                                       */}
        {/* ============================================================= */}
        {activeTab === "reservations" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Filter and Search Bar */}
            <Card className="bg-white rounded-2xl p-4 border-[#E2DACF] shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#718074] z-10" />
                    <Input
                      type="text"
                      value={resSearch}
                      onChange={(e) => setResSearch(e.target.value)}
                      placeholder="Search Booking ID (e.g. PRIN5743), Guest Name, Phone..."
                      className="pl-9 bg-[#FAF8F5] border-[#D7CDBF] text-xs font-sans text-[#133826] placeholder:text-stone-400 h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                    />
                  </div>

                  <select
                    value={resStatusFilter}
                    onChange={(e) => setResStatusFilter(e.target.value)}
                    className="h-9 px-3 rounded-xl border border-[#D7CDBF] bg-[#FAF8F5] text-xs font-semibold text-[#133826] focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="ARRIVED">Arrived</option>
                    <option value="SEATED">Seated</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="CANCELLED">Cancelled</option>
                    <option value="NO_SHOW">No Show</option>
                  </select>
                </div>

                <Badge variant="outline" className="font-sans tabular-nums text-xs px-3 py-1.5 border-[#D7CDBF] text-[#5A6A5E]">
                  Showing {filteredReservations.length} reservations
                </Badge>
              </div>
            </Card>

            {/* Reservations Cards / Table */}
            <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs overflow-hidden">
              <Table>
                <TableHeader className="bg-[#FAF8F5] border-b border-[#EAE3D9]">
                  <TableRow>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Booking ID</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Guest Details</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Date & Slot</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Party Size</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Advance Deposit</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Status</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px] text-right">Manager Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-[#EAE3D9]">
                  {filteredReservations.length > 0 ? (
                    filteredReservations.map((r) => {
                      const bId = r.booking_id || formatBookingId(r.customer_name, r.customer_phone, r.id);
                      const isPaid = (r.payment_status || "").toUpperCase() === "PAID";
                      return (
                        <TableRow key={r.id} className="hover:bg-[#FAF8F5]/80 transition-colors">
                          <TableCell className="py-3.5 px-4 font-mono font-bold text-[#133826]">
                            <Badge variant="success" className="bg-[#EBF5EE] text-[#2D6A4F] border-[#B7E4C7] font-mono tabular-nums text-[11px] px-2 py-0.5">
                              {bId}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <span className="font-bold text-[#133826] block">
                              {r.customer_name || "Guest"}
                            </span>
                            <span className="text-[11px] font-sans tabular-nums text-[#718074]">{r.customer_phone || "—"}</span>
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <span className="font-semibold font-sans tabular-nums text-[#133826] block">{r.reservation_date}</span>
                            <span className="text-[11px] font-sans tabular-nums text-[#718074]">{r.time_slot}</span>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-semibold text-[#133826]">
                            <span className="font-sans font-semibold tabular-nums">{r.guest_count}</span> guests
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-sans font-bold tabular-nums text-sm text-[#133826]">
                                {formatINR(r.advance_amount)}
                              </span>
                              <Badge
                                variant={isPaid ? "success" : "warning"}
                                className="text-[9px] uppercase font-extrabold px-1.5 py-0.5"
                              >
                                {r.payment_status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <select
                              value={(r.status || "CONFIRMED").toUpperCase()}
                              onChange={(e) => handleReservationStatusUpdate(r.id, e.target.value)}
                              className="px-2 py-1 rounded-lg border border-[#D7CDBF] bg-white text-[11px] font-bold text-[#133826] focus:outline-none"
                            >
                              <option value="CONFIRMED">CONFIRMED</option>
                              <option value="ARRIVED">ARRIVED</option>
                              <option value="SEATED">SEATED</option>
                              <option value="COMPLETED">COMPLETED</option>
                              <option value="CANCELLED">CANCELLED</option>
                              <option value="NO_SHOW">NO_SHOW</option>
                            </select>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {r.status === "CONFIRMED" && (
                                <Button
                                  size="sm"
                                  onClick={() => handleReservationCheckin(r.id)}
                                  className="h-7 px-2.5 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                                >
                                  Check In
                                </Button>
                              )}
                              {!isPaid && (
                                <Button
                                  size="sm"
                                  onClick={() => openStaffVerifyModal(r)}
                                  className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                                  title="Verify Deposit"
                                >
                                  Verify Advance
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-stone-500">
                        No reservations found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>

            {/* Advance Payment Verification Modal */}
            {verifyingRes && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
                <Card className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border-[#E2DACF] animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="font-serif font-bold text-lg text-[#133826]">
                      Verify Advance Payment
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVerifyingRes(null)}
                      className="h-7 w-7 p-0 rounded-lg text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <form onSubmit={submitStaffVerifyPayment} className="space-y-4 text-xs">
                    <div className="bg-[#FAF8F5] p-3 rounded-xl border border-[#EAE3D9] space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#718074]">Guest:</span>
                        <span className="font-bold text-[#133826]">{verifyingRes.customer_name || "Guest"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#718074]">Advance Amount:</span>
                        <span className="font-sans font-bold tabular-nums text-emerald-800">{formatINR(verifyingRes.advance_amount)}</span>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-[#133826] mb-1">
                        Bank / UPI Reference (UTR)
                      </label>
                      <Input
                        type="text"
                        required
                        minLength={4}
                        maxLength={50}
                        value={enteredUtr}
                        onChange={(e) => setEnteredUtr(e.target.value)}
                        placeholder="e.g. 426819283741"
                        className="bg-[#FAF8F5] border-[#D7CDBF] font-mono tabular-nums text-xs text-[#133826] h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                      />
                      <span className="text-[10px] text-[#718074] mt-1 block">
                        Confirm UTR from bank SMS, Soundbox, or statement before verifying.
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setVerifyingRes(null)}
                        className="flex-1 border-[#D7CDBF] bg-white font-bold text-xs h-9 rounded-xl"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={isSubmittingVerify}
                        className="flex-1 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-bold text-xs h-9 rounded-xl shadow-xs disabled:opacity-50"
                      >
                        {isSubmittingVerify ? "Verifying..." : "Confirm & Settle"}
                      </Button>
                    </div>
                  </form>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 6: MENU MANAGEMENT                                        */}
        {/* ============================================================= */}
        {activeTab === "menu" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top Menu Controls */}
            <Card className="bg-white rounded-2xl p-4 border-[#E2DACF] shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Category Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 min-w-[280px]">
                  <Button
                    variant={selectedCategory === "ALL" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setSelectedCategory("ALL")}
                    className={`rounded-xl text-xs font-semibold h-8 transition-colors ${
                      selectedCategory === "ALL"
                        ? "bg-[#1B4332] text-white hover:bg-[#2D6A4F]"
                        : "bg-[#FAF8F5] text-[#5A6A5E] hover:bg-stone-100 border-[#E2DACF]"
                    }`}
                  >
                    All Items (<span className="font-sans tabular-nums">{menuItems.length}</span>)
                  </Button>
                  {categories.map((cat) => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`rounded-xl text-xs font-semibold h-8 transition-colors whitespace-nowrap ${
                        selectedCategory === cat.id
                          ? "bg-[#1B4332] text-white hover:bg-[#2D6A4F]"
                          : "bg-[#FAF8F5] text-[#5A6A5E] hover:bg-stone-100 border-[#E2DACF]"
                      }`}
                    >
                      {cat.name}
                    </Button>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsNewCatModalOpen(true)}
                    className="h-8 rounded-xl border-[#D7CDBF] bg-white hover:bg-stone-50 text-xs font-bold text-[#133826] flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Category</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={openAddModal}
                    className="h-8 px-3.5 rounded-xl bg-[#1B4332] hover:bg-[#2D6A4F] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Menu Item</span>
                  </Button>
                </div>
              </div>
            </Card>

            {/* Menu Items Table */}
            <Card className="bg-white rounded-2xl border-[#E2DACF] shadow-xs overflow-hidden">
              <Table>
                <TableHeader className="bg-[#FAF8F5] border-b border-[#EAE3D9]">
                  <TableRow>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Item Name</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Category</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Price (₹)</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Tax (GST)</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px]">Availability</TableHead>
                    <TableHead className="py-3 px-4 font-bold text-[#5A6A5E] text-[10px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-[#EAE3D9]">
                  {filteredMenuItems.length > 0 ? (
                    filteredMenuItems.map((item) => {
                      const cat = categories.find((c) => c.id === item.category_id);
                      return (
                        <TableRow key={item.id} className="hover:bg-[#FAF8F5]/80 transition-colors">
                          <TableCell className="py-3.5 px-4">
                            <span className="font-bold text-[#133826] block">{item.name}</span>
                            {item.description && (
                              <span className="text-[11px] text-[#718074] line-clamp-1">
                                {item.description}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-semibold text-[#5A6A5E]">
                            {cat?.name || "General"}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-sans font-bold tabular-nums text-sm text-[#133826]">
                            {formatINR(item.price)}
                          </TableCell>
                          <TableCell className="py-3.5 px-4 font-sans font-semibold tabular-nums text-[11px] text-stone-600">
                            {item.tax_rate}%
                          </TableCell>
                          <TableCell className="py-3.5 px-4">
                            <Badge
                              variant={item.is_available ? "success" : "destructive"}
                              onClick={() => handleToggleMenuAvailability(item)}
                              className="cursor-pointer tracking-wider text-[10px]"
                            >
                              {item.is_available ? "In Stock" : "Sold Out"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3.5 px-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditModal(item)}
                              className="h-7 w-7 p-0 rounded-lg border-[#D7CDBF] bg-white hover:bg-stone-50 text-[#133826]"
                              title="Edit Item"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-stone-500">
                        No menu items found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>

            {/* Menu Item Edit / Add Modal */}
            {(editingItem || isNewItemModalOpen) && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
                <Card className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-[#E2DACF] animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="font-serif font-bold text-lg text-[#133826]">
                      {editingItem ? `Edit: ${editingItem.name}` : "Add New Menu Item"}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingItem(null);
                        setIsNewItemModalOpen(false);
                      }}
                      className="h-7 w-7 p-0 rounded-lg text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <form onSubmit={handleSaveMenuItem} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-semibold text-[#133826] mb-1">Item Name</label>
                      <Input
                        type="text"
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Margherita Classico"
                        className="bg-[#FAF8F5] border-[#D7CDBF] text-xs text-[#133826] h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-[#133826] mb-1">Price (₹)</label>
                        <Input
                          type="number"
                          step="0.01"
                          required
                          value={formPrice}
                          onChange={(e) => setFormPrice(e.target.value)}
                          placeholder="e.g. 450"
                          className="bg-[#FAF8F5] border-[#D7CDBF] font-sans tabular-nums text-xs text-[#133826] h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-[#133826] mb-1">GST Tax (%)</label>
                        <Input
                          type="number"
                          step="0.01"
                          required
                          value={formTax}
                          onChange={(e) => setFormTax(e.target.value)}
                          placeholder="5.00"
                          className="bg-[#FAF8F5] border-[#D7CDBF] font-sans tabular-nums text-xs text-[#133826] h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-[#133826] mb-1">Category</label>
                      <select
                        value={formCatId}
                        onChange={(e) => setFormCatId(parseInt(e.target.value))}
                        className="w-full h-9 px-3 rounded-xl border border-[#D7CDBF] bg-[#FAF8F5] text-xs text-[#133826] focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-[#133826] mb-1">Description</label>
                      <textarea
                        rows={3}
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        placeholder="San Marzano tomato sauce, fresh buffalo mozzarella, basil..."
                        className="w-full p-3 rounded-xl border border-[#D7CDBF] bg-[#FAF8F5] text-xs text-[#133826] focus:outline-none focus:ring-2 focus:ring-[#2D6A4F]"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="formAvailable"
                        checked={formAvailable}
                        onChange={(e) => setFormAvailable(e.target.checked)}
                        className="w-4 h-4 rounded text-[#2D6A4F] accent-[#2D6A4F]"
                      />
                      <label htmlFor="formAvailable" className="font-semibold text-[#133826] cursor-pointer">
                        Item Available In Kitchen
                      </label>
                    </div>

                    <div className="flex items-center gap-2 pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingItem(null);
                          setIsNewItemModalOpen(false);
                        }}
                        className="flex-1 border-[#D7CDBF] bg-white font-bold text-xs h-9 rounded-xl"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-bold text-xs h-9 rounded-xl shadow-xs"
                      >
                        Save Item
                      </Button>
                    </div>
                  </form>
                </Card>
              </div>
            )}

            {/* New Category Modal */}
            {isNewCatModalOpen && (
              <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
                <Card className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border-[#E2DACF] animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="font-serif font-bold text-lg text-[#133826]">
                      Create Category
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsNewCatModalOpen(false)}
                      className="h-7 w-7 p-0 rounded-lg text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <form onSubmit={handleCreateCategory} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-semibold text-[#133826] mb-1">Category Name</label>
                      <Input
                        type="text"
                        required
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="e.g. Artisanal Tisanes"
                        className="bg-[#FAF8F5] border-[#D7CDBF] text-xs text-[#133826] h-9 rounded-xl focus-visible:ring-[#2D6A4F]"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsNewCatModalOpen(false)}
                        className="flex-1 border-[#D7CDBF] bg-white font-bold text-xs h-9 rounded-xl"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1 bg-[#1B4332] hover:bg-[#2D6A4F] text-white font-bold text-xs h-9 rounded-xl shadow-xs"
                      >
                        Create
                      </Button>
                    </div>
                  </form>
                </Card>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
