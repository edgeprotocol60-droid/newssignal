import { drizzle } from "drizzle-orm/netlify-db";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { analysisDesks } from "../../db/schema.js";
export default async (req: Request) => {
  const url = new URL(req.url);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Netlify-CDN-Cache-Control": "no-store",
  });
  if (!["GET", "PUT"].includes(req.method))
    return new Response("{}", { status: 405, headers });
  if (req.method === "PUT" && req.headers.get("origin") !== url.origin)
    return new Response("{}", { status: 403, headers });
  const existing = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("qa_desk="))
    ?.slice(8);
  const key =
    existing && /^[a-f0-9]{64}$/.test(existing)
      ? existing
      : randomBytes(32).toString("hex");
  if (key !== existing)
    headers.append(
      "Set-Cookie",
      `qa_desk=${key}; HttpOnly; Secure; SameSite=Strict; Path=/api/desk; Max-Age=31536000`,
    );
  const id = createHash("sha256").update(key).digest("hex");
  try {
    const db = drizzle();
    if (req.method === "GET") {
      const rows = await db
        .select({ data: analysisDesks.data })
        .from(analysisDesks)
        .where(eq(analysisDesks.id, id))
        .limit(1);
      return Response.json(
        rows[0]?.data || { risk: {}, anchors: {}, journal: [] },
        { headers },
      );
    }
    const raw = await req.text();
    if (raw.length > 100000)
      return new Response("{}", { status: 413, headers });
    const b = JSON.parse(raw),
      markets = [
        "XAUUSD",
        "NAS100",
        "DXY",
        "EURUSD",
        "GBPUSD",
        "USDJPY",
        "AUDUSD",
      ];
    if (
      !b ||
      !Array.isArray(b.journal) ||
      b.journal.length > 500 ||
      typeof b.risk !== "object" ||
      typeof b.anchors !== "object"
    )
      return new Response("{}", { status: 400, headers });
    const risk: Record<string, Record<string, number | string>> = {},
      anchors: Record<string, number> = {};
    for (const sym of markets) {
      if (
        Number.isFinite(b.anchors[sym]) &&
        b.anchors[sym] > 0 &&
        b.anchors[sym] <= Date.now()
      )
        anchors[sym] = b.anchors[sym];
      const r = b.risk[sym];
      if (!r) continue;
      risk[sym] = {};
      for (const k of [
        "account",
        "riskPct",
        "entry",
        "stop",
        "target",
        "contract",
        "pointValue",
        "minRR",
        "lossLimit",
        "winProb",
        "resultR",
      ])
        if (Number.isFinite(r[k]) && Math.abs(r[k]) < 1e12) risk[sym][k] = r[k];
      risk[sym].currency = r.currency === "ZAR" ? "ZAR" : "USD";
    }
    const journal = b.journal
      .filter(
        (r: any) =>
          markets.includes(r.sym) &&
          Number.isFinite(r.r) &&
          Math.abs(r.r) <= 100 &&
          Number.isFinite(r.t) &&
          Number.isFinite(r.riskUSD) &&
          r.riskUSD >= 0 &&
          r.riskUSD <= 1e10,
      )
      .map((r: any) => ({ sym: r.sym, r: r.r, t: r.t, riskUSD: r.riskUSD }));
    const data = { risk, anchors, journal };
    await db
      .insert(analysisDesks)
      .values({ id, data })
      .onConflictDoUpdate({
        target: analysisDesks.id,
        set: { data, updatedAt: new Date() },
      });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "Journal storage unavailable; retry after deploy." },
      { status: 503, headers },
    );
  }
};
export const config = { path: "/api/desk" };
