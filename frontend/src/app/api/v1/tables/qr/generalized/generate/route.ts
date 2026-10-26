import { NextRequest, NextResponse } from "next/server";
import { addStoredQr } from "@/lib/generalizedQrStore";
import { getUpstreamUrl } from "@/lib/upstream";

// ponytail: Generate fresh generalized QR token with upstream proxy and high-availability fallback
export async function POST(req: NextRequest) {
  const upstream = getUpstreamUrl();
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    return NextResponse.json({ detail: "Staff authorization required." }, { status: 401 });
  }

  // 1. Try upstream backend directly
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: authHeader,
    };

    const upRes = await fetch(`${upstream}/api/v1/tables/qr/generalized/generate`, {
      method: "POST",
      headers,
    });

    if (upRes.ok) {
      const data = await upRes.json();
      return NextResponse.json(data);
    }
  } catch {
    // Fall through to fallback
  }

  // 2. Fallback: Rotate Table 1's QR code on upstream if available
  let newToken: string | null = null;
  let newId: number | undefined;
  let createdAt: string | undefined;

  try {
    if (authHeader) {
      const rotRes = await fetch(`${upstream}/api/v1/tables/1/qr/rotate`, {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      if (rotRes.ok) {
        const rotData = await rotRes.json();
        if (rotData?.qr_token) {
          newToken = rotData.qr_token;
          newId = rotData.id;
          createdAt = rotData.created_at;
        }
      }
    }
  } catch {
    // Continue to token generator
  }

  if (!newToken) {
    const rawUuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).substring(2) + Date.now().toString(36);
    newToken = `qr_sec_${rawUuid}`;
  }

  const record = addStoredQr(newToken, "Generalized Dining Hub");
  if (newId) record.id = newId;
  if (createdAt) record.created_at = createdAt;

  return NextResponse.json(record);
}
