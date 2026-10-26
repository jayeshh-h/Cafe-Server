import { NextRequest, NextResponse } from "next/server";
import { getUpstreamUrl } from "@/lib/upstream";

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: {
      type: "string",
      description: "Name of the supplier / seller business at the top of the bill",
    },
    bill_number: {
      type: "string",
      description: "Invoice or bill number",
    },
    bill_date: {
      type: "string",
      description: "Invoice date, as YYYY-MM-DD",
    },
    grand_total: {
      type: "number",
      description: "Final amount payable including taxes, in INR",
    },
    line_items: {
      type: "array",
      description: "Every purchased item row in the bill table",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Item name exactly as printed",
          },
          quantity: {
            type: "number",
            description: "Quantity purchased",
          },
          unit: {
            type: "string",
            description: "Unit of quantity, e.g. kg, g, ltr, ml, pcs",
          },
          unit_price: {
            type: "number",
            description: "Rate per unit in INR, before tax",
          },
          amount: {
            type: "number",
            description: "Line amount in INR, before tax",
          },
        },
      },
    },
  },
};

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  l: "l",
  lt: "l",
  ltr: "l",
  ltrs: "l",
  litre: "l",
  liter: "l",
  litres: "l",
  liters: "l",
  ml: "ml",
  mls: "ml",
  millilitre: "ml",
  milliliter: "ml",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  nos: "pcs",
  no: "pcs",
  unit: "pcs",
  units: "pcs",
  btl: "pcs",
  bottle: "pcs",
  bottles: "pcs",
  can: "pcs",
  cans: "pcs",
  pkt: "pcs",
  packet: "pcs",
  pack: "pcs",
  box: "pcs",
  dozen: "dozen",
  dz: "dozen",
};

const UNIT_FACTORS: Record<string, number> = {
  "kg:g": 1000,
  "g:kg": 0.001,
  "l:ml": 1000,
  "ml:l": 0.001,
  "dozen:pcs": 12,
};

const STOPWORDS = new Set([
  "fresh",
  "the",
  "and",
  "of",
  "with",
  "pack",
  "pkt",
  "btl",
  "bottle",
  "block",
  "loose",
  "premium",
  "brand",
  "quality",
  "grade",
  "amul",
  "local",
]);

function normalizeUnit(unit?: string | null): string {
  const u = (unit || "").toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_ALIASES[u] || u;
}

function convertQuantity(qty: number, fromUnit?: string | null, toUnit?: string | null): number | null {
  const f = normalizeUnit(fromUnit);
  const t = normalizeUnit(toUnit);
  if (f === t || !f) return qty;
  const factor = UNIT_FACTORS[`${f}:${t}`];
  if (factor != null) {
    return Math.round(qty * factor * 10000) / 10000;
  }
  return null;
}

function tokenize(text: string): Set<string> {
  const words = (text || "").toLowerCase().match(/[a-z]+/g) || [];
  const out = new Set<string>();
  for (let w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (w.endsWith("oes")) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

function suggestMaterial(
  desc: string,
  materials: { id: number; name: string }[]
): { id: number | null; score: number } {
  const descTokens = tokenize(desc);
  let bestId: number | null = null;
  let bestScore = 0;
  let bestOverlap = 0;

  for (const mat of materials) {
    const matTokens = tokenize(mat.name);
    if (!matTokens.size || !descTokens.size) continue;
    let overlap = 0;
    for (const t of matTokens) {
      if (descTokens.has(t)) overlap++;
    }
    const score = overlap / matTokens.size;
    if (overlap > 0 && (score > bestScore || (score === bestScore && overlap > bestOverlap))) {
      bestId = mat.id;
      bestScore = score;
      bestOverlap = overlap;
    }
  }

  return bestScore >= 0.5 ? { id: bestId, score: Math.round(bestScore * 100) / 100 } : { id: null, score: 0 };
}

// ponytail: native Next.js environment loading for Sarvam API key
export async function POST(req: NextRequest) {
  // ponytail: enforce staff authorization before invoking bill extraction
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ detail: "Staff authorization required." }, { status: 401 });
  }

  const sarvamKey = process.env.SARVAM_API_KEY;
  const baseUrl = (process.env.SARVAM_BASE_URL || "https://api.sarvam.ai").replace(/\/$/, "");
  const upstream = getUpstreamUrl();

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ detail: "Upload a JPG, PNG or PDF of the bill." }, { status: 400 });
    }

    if (!sarvamKey) {
      return NextResponse.json(
        { detail: "Bill scanning is not configured (SARVAM_API_KEY missing)." },
        { status: 503 }
      );
    }

    const sarvamForm = new FormData();
    sarvamForm.append("file", file, (file as File).name || "bill.png");
    sarvamForm.append("schema", JSON.stringify(EXTRACT_SCHEMA));
    sarvamForm.append("language", "en-IN");
    sarvamForm.append("output_format", "json");

    const startRes = await fetch(`${baseUrl}/doc-ai/v1/job/extract`, {
      method: "POST",
      headers: {
        "api-subscription-key": sarvamKey,
      },
      body: sarvamForm,
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      let msg = "Sarvam AI rejected the bill file.";
      try {
        const j = JSON.parse(errText);
        msg = j.detail || j.message || msg;
      } catch {
        // ignore
      }
      return NextResponse.json({ detail: msg }, { status: 502 });
    }

    const startData = await startRes.json();
    const jobId = startData.job_id;
    if (!jobId) {
      return NextResponse.json({ detail: "Bill reader did not return a valid job ID." }, { status: 502 });
    }

    // Poll until completed or timeout (max 90s)
    let waited = 0;
    let jobStatus = "pending";
    const terminalStatuses = new Set(["completed", "partially_completed", "failed", "rejected"]);

    while (waited < 90) {
      await new Promise((r) => setTimeout(r, 2000));
      waited += 2;

      const statusRes = await fetch(`${baseUrl}/doc-ai/v1/job/${jobId}/status`, {
        headers: { "api-subscription-key": sarvamKey },
      });

      if (statusRes.ok) {
        const sData = await statusRes.json();
        jobStatus = sData.status;
        if (terminalStatuses.has(jobStatus)) {
          break;
        }
      }
    }

    if (jobStatus !== "completed" && jobStatus !== "partially_completed") {
      return NextResponse.json(
        { detail: jobStatus === "failed" ? "Could not read the bill. Try a clearer photo." : "Bill reading timed out." },
        { status: 502 }
      );
    }

    // Fetch extract result
    const resultsRes = await fetch(`${baseUrl}/doc-ai/v1/job/${jobId}/results`, {
      headers: { "api-subscription-key": sarvamKey },
    });

    if (!resultsRes.ok) {
      return NextResponse.json({ detail: "Could not fetch the bill reading result." }, { status: 502 });
    }

    const resultsData = await resultsRes.json();
    const extractResult = resultsData.result || resultsData.data || resultsData || {};

    // Fetch existing raw materials from inventory upstream
    let materials: { id: number; name: string; unit_of_measure: string }[] = [];
    const authHeader = req.headers.get("authorization");

    try {
      const invRes = await fetch(`${upstream}/api/v1/inventory`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (invRes.ok) {
        materials = await invRes.json();
      }
    } catch {
      // Fallback: proceed without materials if upstream query fails
    }

    const nameIndex = materials.map((m) => ({ id: m.id, name: m.name }));
    const unitById = new Map<number, string>(materials.map((m) => [m.id, m.unit_of_measure]));

    const lines = (extractResult.line_items || []).map((row: any) => {
      const qty = row.quantity != null ? Number(row.quantity) : null;
      const unitPrice = row.unit_price != null ? Number(row.unit_price) : null;
      let amount = row.amount != null ? Number(row.amount) : null;
      if (amount == null && qty != null && unitPrice != null) {
        amount = Math.round(qty * unitPrice * 100) / 100;
      }

      const { id: matId, score } = suggestMaterial(row.description || "", nameIndex);
      let stockQty: number | null = null;
      if (matId != null && qty != null) {
        const targetUnit = unitById.get(matId);
        stockQty = convertQuantity(qty, row.unit, targetUnit);
      }

      return {
        description: (row.description || "").trim(),
        quantity: qty,
        unit: (row.unit || "").trim(),
        unit_price: unitPrice,
        amount,
        suggested_material_id: matId,
        match_score: score,
        stock_quantity: stockQty,
      };
    });

    return NextResponse.json({
      supplier_name: (extractResult.supplier_name || "").trim() || null,
      bill_number: (extractResult.bill_number || "").trim() || null,
      bill_date: (extractResult.bill_date || "").trim() || null,
      grand_total: extractResult.grand_total != null ? Number(extractResult.grand_total) : null,
      lines,
    });
  } catch (err: any) {
    return NextResponse.json(
      { detail: `Error processing bill: ${err?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}
