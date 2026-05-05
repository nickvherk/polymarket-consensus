// Server-side Falcon API client — called directly from API routes (key never exposed to client).

const API_URL = "https://narrative.agent.heisenberg.so/api/v2/semantic/retrieve/parameterized";
const FORMATTER_CONFIG = { format_type: "raw", timestamp: "" };

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  proxy_wallet: string;
  displayName: string;
  total_pnl: number;
  win_rate: number;      // 0–1
  roi: number;
  total_trades: number;
  volume: number;
  sharpe_ratio: number;
  markets_traded: number;
}

export interface CryptoStats {
  pnl: number;
  win_rate: number;  // 0–1
  trades: number;
  roi: number;       // 0–1
}

export interface Wallet360 {
  proxy_wallet: string;
  displayName: string;
  total_pnl: number;
  win_rate: number;
  roi: number;
  sharpe_ratio: number;
  max_drawdown: number;
  avg_position_size: number;
  total_trades: number;
  days_active: number;
  performance_trend: string;
  risk_level: string;
  sybil_risk: boolean;
  sybil_risk_score: number;
  crypto_stats: CryptoStats | null;
  last_active: string;
  combined_risk_score: number;
  equity_curve_pattern: string;
  profit_factor: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const p = parseFloat(v); return isNaN(p) ? 0 : p; }
  return 0;
}
function s(v: unknown): string { return typeof v === "string" ? v : ""; }
function b(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  return Boolean(v);
}

export function fmtAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function extractRecords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  for (const k of ["results", "data", "records", "traders", "leaderboard", "items"]) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  for (const ok of ["data", "response", "body"]) {
    const outer = obj[ok];
    if (outer && typeof outer === "object" && !Array.isArray(outer)) {
      const o = outer as Record<string, unknown>;
      for (const ik of ["results", "data", "items", "records", "traders"]) {
        if (Array.isArray(o[ik])) return o[ik] as unknown[];
      }
    }
  }
  return [];
}

function unwrap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  for (const k of ["document", "payload", "content", "record", "item"]) {
    if (r[k] && typeof r[k] === "object" && !Array.isArray(r[k])) {
      return r[k] as Record<string, unknown>;
    }
  }
  return r;
}

// ─── Normalisers ────────────────────────────────────────────────────────────────

function normalizeLeaderboard(raw: unknown): LeaderboardEntry | null {
  const r = unwrap(raw);
  const wallet = s(r.address ?? r.proxy_wallet ?? r.wallet ?? r.proxyWallet ?? r.user_address ?? "");
  if (!wallet) return null;
  return {
    proxy_wallet: wallet,
    displayName: s(r.username ?? r.user_name ?? r.name ?? r.trader_name ?? r.display_name ?? "") || fmtAddr(wallet),
    total_pnl: n(r.total_pnl ?? r.pnl ?? r.profit_loss ?? 0),
    win_rate: n(r.win_rate ?? r.winRate ?? r.win_rate_pct ?? 0),
    roi: n(r.roi ?? r.return_on_investment ?? 0),
    total_trades: n(r.total_trades ?? r.num_trades ?? r.trade_count ?? 0),
    volume: n(r.volume ?? r.total_volume ?? r.total_invested ?? 0),
    sharpe_ratio: n(r.sharpe_ratio ?? r.sharpe ?? 0),
    markets_traded: n(r.markets_traded ?? r.marketsTraded ?? r.num_markets ?? 0),
  };
}

function normalizeWallet360(raw: unknown): Wallet360 | null {
  const r = unwrap(raw);
  const wallet = s(r.address ?? r.proxy_wallet ?? r.wallet ?? r.proxyWallet ?? "");
  if (!wallet) return null;

  // Parse performance_by_category for Crypto stats
  let crypto_stats: CryptoStats | null = null;
  const rawCats = r.performance_by_category;
  let cats: unknown[] = [];
  if (typeof rawCats === "string") {
    try { cats = JSON.parse(rawCats); } catch { /* ignore */ }
  } else if (Array.isArray(rawCats)) {
    cats = rawCats;
  }
  const catNames = cats
    .filter((c) => c && typeof c === "object")
    .map((c) => s((c as Record<string, unknown>).category ?? ""));
  const hasCrypto = catNames.some((name) => name === "Crypto");
  const hasNonCryptoDomain = catNames.some((name) => name !== "Other" && !name.startsWith("Crypto") && name !== "");
  const cryptoCat = cats.find(
    (c) => c && typeof c === "object" && s((c as Record<string, unknown>).category ?? "") === "Crypto"
  ) as Record<string, unknown> | undefined;
  if (hasCrypto && !hasNonCryptoDomain && cryptoCat) {
    crypto_stats = {
      pnl: n(cryptoCat.total_pnl ?? 0),
      win_rate: n(cryptoCat.win_rate ?? 0),
      trades: n(cryptoCat.total_trades ?? 0),
      roi: n(cryptoCat.roi ?? 0) / 100,
    };
  }

  return {
    proxy_wallet: wallet,
    displayName: s(r.username ?? r.user_name ?? r.name ?? r.display_name ?? ""),
    total_pnl: n(r.total_pnl ?? r.pnl ?? 0),
    win_rate: n(r.win_rate ?? r.winRate ?? 0),
    roi: n(r.roi ?? r.return_on_investment ?? 0),
    sharpe_ratio: n(r.sharpe_ratio ?? r.sharpe ?? 0),
    max_drawdown: n(r.max_drawdown ?? r.maxDrawdown ?? 0),
    avg_position_size: n(r.avg_position_size ?? r.average_position_size ?? 0),
    total_trades: n(r.total_trades ?? r.num_trades ?? 0),
    days_active: n(r.days_active ?? r.active_days ?? r.daysActive ?? 0),
    performance_trend: s(r.performance_trend ?? r.trend ?? "stable"),
    risk_level: s(r.risk_level ?? r.riskLevel ?? "MEDIUM"),
    sybil_risk: b(r.sybil_risk_flag ?? r.sybil_risk ?? r.sybilRisk ?? r.is_sybil ?? false),
    sybil_risk_score: n(r.sybil_risk_score ?? r.sybilRiskScore ?? 0),
    crypto_stats,
    last_active: s(r.last_active ?? r.lastActive ?? ""),
    combined_risk_score: n(r.combined_risk_score ?? r.combinedRiskScore ?? 0),
    equity_curve_pattern: s(r.equity_curve_pattern ?? r.equityCurvePattern ?? ""),
    profit_factor: n(r.profit_factor ?? r.profitFactor ?? 0),
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────────

async function falconPost(body: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.FALCON_API_KEY;
  if (!apiKey) throw new Error("FALCON_API_KEY not set");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    if (res.status === 429) { console.log(`[falcon] 429 — retry ${attempt + 1}`); continue; }
    if (!res.ok) throw new Error(`Falcon ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
  throw new Error("Falcon: rate limited after 3 retries");
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export async function fetchLeaderboardByTrades(): Promise<LeaderboardEntry[]> {
  console.log("[falcon] fetching leaderboard (agent 579, sort=total_trades)");
  const raw = await falconPost({
    agent_id: 579,
    params: {
      wallet_address: "ALL",
      leaderboard_period: "7d",
      sort_by: "total_trades",
      min_total_pnl: "0",
      min_trades: "0",
    },
    pagination: { limit: 100, offset: 0 },
    formatter_config: FORMATTER_CONFIG,
  });
  console.log("[falcon] leaderboard raw:", JSON.stringify(raw, null, 2));
  return extractRecords(raw).map(normalizeLeaderboard).filter((e): e is LeaderboardEntry => e !== null);
}

export async function fetchWallet360(address: string): Promise<Wallet360 | null> {
  const raw = await falconPost({
    agent_id: 581,
    params: { proxy_wallet: address, window_days: "7" },
    formatter_config: FORMATTER_CONFIG,
  });
  const records = extractRecords(raw);
  if (!records.length) return null;
  return normalizeWallet360(records[0]);
}

// Run `limit` concurrent tasks at a time over `items`
export async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        console.error(`[falcon] withConcurrency error at index ${i}:`, err);
        results[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
