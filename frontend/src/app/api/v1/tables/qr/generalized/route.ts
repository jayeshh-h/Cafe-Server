import { NextRequest, NextResponse } from "next/server";
import { getStoredQrs, addStoredQr } from "@/lib/generalizedQrStore";
import { getUpstreamUrl } from "@/lib/upstream";

// ponytail: Generalized QR hub endpoint with upstream proxy and high-availability fallback
export async function GET(req: NextRequest) {
  const upstream = getUpstreamUrl();
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    return NextResponse.json({ detail: "Staff authorization required." }, { status: 401 });
  }

  // 1. Try upstream backend directly
  try {
    const headers: Record<string, string> = { Authorization: authHeader };

    const upRes = await fetch(`${upstream}/api/v1/tables/qr/generalized`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (upRes.ok) {
      const data = await upRes.json();
      return NextResponse.json(data);
    }
  } catch {
    // Fall through to fallback
  }

  // 2. Fallback: If upstream does not have the new route yet, check table 1's active QR on upstream
  try {
    if (authHeader) {
      const t1Res = await fetch(`${upstream}/api/v1/tables/1/qr`, {
        method: "GET",
        headers: { Authorization: authHeader },
        cache: "no-store",
      });
      if (t1Res.ok) {
        const t1Data = await t1Res.json();
        if (t1Data?.qr_token) {
          const list = getStoredQrs();
          const exists = list.some((item) => item.qr_token === t1Data.qr_token);
          if (!exists) {
            addStoredQr(t1Data.qr_token, "Generalized Table QR (Table 1 Synced)");
          }
        }
      }
    }
  } catch {
    // Continue with stored list
  }

  const list = getStoredQrs();
  const activeQr = list.find((item) => item.is_active) || (list.length > 0 ? list[0] : null);

  return NextResponse.json({
    active_qr: activeQr,
    all_qrs: list,
  });
}

export async function DELETE(req: NextRequest) {
  const upstream = getUpstreamUrl();
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    return NextResponse.json({ detail: "Staff authorization required." }, { status: 401 });
  }

  try {
    let qrToken = req.nextUrl.searchParams.get("qr_token");
    let id = req.nextUrl.searchParams.get("id");

    if (!qrToken && !id) {
      try {
        const body = await req.json();
        qrToken = body.qr_token;
        id = body.id;
      } catch {}
    }

    // 1. Try upstream backend
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      const upRes = await fetch(`${upstream}/api/v1/tables/qr/generalized?qr_token=${qrToken || ""}&id=${id || ""}`, {
        method: "DELETE",
        headers,
      });
      if (upRes.ok) {
        return NextResponse.json(await upRes.json());
      }
    } catch {
      // Fall through
    }

    // 2. Delete from local store
    const { deleteStoredQr } = await import("@/lib/generalizedQrStore");
    deleteStoredQr(id ? Number(id) : qrToken || "");

    return NextResponse.json({ success: true, message: "QR code deleted successfully" });
  } catch (err: any) {
    return NextResponse.json({ detail: err?.message || "Failed to delete QR" }, { status: 500 });
  }
}

