import { NextRequest, NextResponse } from "next/server";
import { getStoredQrs } from "@/lib/generalizedQrStore";
import { getUpstreamUrl } from "@/lib/upstream";

// ponytail: Robust QR validator that supports both table-specific and generalized QR codes
export async function POST(req: NextRequest) {
  const upstream = getUpstreamUrl();
  if (!upstream) {
    return NextResponse.json({ detail: "API upstream is not configured." }, { status: 502 });
  }

  try {
    const body = await req.json();
    const { qr_token } = body;

    if (!qr_token) {
      return NextResponse.json({ detail: "QR token required" }, { status: 400 });
    }

    // 1. Check if token is locally known and inactive
    const stored = getStoredQrs().find((item) => item.qr_token === qr_token);
    if (stored && !stored.is_active) {
      return NextResponse.json(
        { detail: "This QR code has been deactivated by management. Please request an active code from staff." },
        { status: 400 }
      );
    }

    // 2. Try validating with upstream directly
    try {
      const upRes = await fetch(`${upstream}/api/v1/tables/qr/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr_token }),
      });

      if (upRes.ok) {
        const data = await upRes.json();
        // Generalized QR tokens start with qr_gen_; per-table tokens (qr_sec_) keep their real table number
        if (stored || qr_token.startsWith("qr_gen_")) {
          data.is_generalized = true;
          data.table_number = "Table allotted by server";
        }
        return NextResponse.json(data);
      }
    } catch {
      // Continue to fallback
    }

    // 3. Fallback: If this is a valid active generalized token not yet synced in Render's older schema,
    // get a live dining session on Table 1 so the guest can order seamlessly
    if (stored && stored.is_active) {
      try {
        const seedToken = "qr_sec_b7ba9c59d35e4074a30034abb48ee0a9";
        const seedRes = await fetch(`${upstream}/api/v1/tables/qr/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr_token: seedToken }),
        });

        if (seedRes.ok) {
          const seedData = await seedRes.json();
          return NextResponse.json({
            ...seedData,
            is_generalized: true,
            table_number: "Table allotted by server",
          });
        }
      } catch {
        // Continue
      }
    }

    return NextResponse.json(
      { detail: "Invalid or expired table QR code." },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { detail: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
