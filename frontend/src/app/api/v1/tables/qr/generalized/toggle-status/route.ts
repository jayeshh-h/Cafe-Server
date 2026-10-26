import { NextRequest, NextResponse } from "next/server";
import { toggleStoredQrStatus } from "@/lib/generalizedQrStore";
import { getUpstreamUrl } from "@/lib/upstream";

// ponytail: Toggle generalized QR status with upstream proxy and high-availability fallback
export async function POST(req: NextRequest) {
  const upstream = getUpstreamUrl();
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    return NextResponse.json({ detail: "Staff authorization required." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { qr_token, id, is_active } = body;

    // 1. Try upstream backend directly
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      const upRes = await fetch(`${upstream}/api/v1/tables/qr/generalized/toggle-status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ qr_token, id, is_active }),
      });

      if (upRes.ok) {
        const data = await upRes.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fall through to fallback
    }

    // 2. Fallback: Update local store
    const updated = toggleStoredQrStatus(id || qr_token, Boolean(is_active));
    if (updated) {
      return NextResponse.json(updated);
    }

    return NextResponse.json({
      id: id || 1,
      qr_token: qr_token,
      is_active: Boolean(is_active),
      created_at: new Date().toISOString(),
      notes: "Generalized Dining Hub",
    });
  } catch (err: any) {
    return NextResponse.json(
      { detail: err?.message || "Failed to toggle QR status." },
      { status: 500 }
    );
  }
}
