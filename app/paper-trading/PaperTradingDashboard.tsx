"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WalletSummary, TrackedTrade, TradeOutcome } from "@/lib/tradeTracker";

const STARTING_BALANCE = 1000;
const REFRESH_INTERVAL = 60_000;

const WALLETS = [
  { address: "0x6e1d5040d0ac73709b0621f620d2a60b80d2d0fa", name: "High Frequency" },
  { address: "0x7dfcf54ea9b8e90e69af427e87e652e8aab2da6e", name: "Asymmetric" },
  { address: "0x06dc51826bc524d9a83770e7de9dd7e005b04524", name: "High Precision" },
];

// ─── Legacy Falcon stats (existing dashboard) ───────────────────────────────

interface WalletStats {
  total_pnl: number;
  win_rate: number;
  roi: number;
  avg_position_size: number;
  total_trades: number;
  last_active: string;
  performance_trend: string;
  sharpe_ratio: number;
  max_drawdown: number;
  profit_factor: number;
  days_active: number;
}

interface WalletData {
  address: string;
  name: string;
  stats: WalletStats | null;
  error: string | null;
}

interface EquityPoint { t: number; v: number; }

interface WalletState {
  address: string;
  name: string;
  stats: WalletStats | null;
  balance: number;
  pnlTotal: number;
  pnlToday: number;
  roi: number;
  tradesTotal: number;
  tradesToday: number;
  winRate: number;
  isActive: boolean;
  equity: EquityPoint[];
}

function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function generateSyntheticEquity(end: number, winRate: number, seed: number): EquityPoint[] {
  const rand = seededRandom(seed);
  const numPoints = 48;
  const now = Date.now();
  const start = now - 7 * 24 * 60 * 60 * 1000;
  const points: EquityPoint[] = [];
  let v = STARTING_BALANCE;
  const drift = (end - STARTING_BALANCE) / numPoints;
  const volatility = Math.abs(end - STARTING_BALANCE) * (1 - winRate) * 0.5;
  for (let i = 0; i <= numPoints; i++) {
    if (i === numPoints) { points.push({ t: now, v: end }); }
    else {
      const noise = (rand() - 0.5) * 2 * volatility;
      v = Math.max(0, v + drift + noise / numPoints);
      points.push({ t: start + (i / numPoints) * (now - start), v: Math.round(v * 100) / 100 });
    }
  }
  return points;
}

function computeWalletState(wallet: WalletData, storedEquity: EquityPoint[] | null): WalletState {
  const stats = wallet.stats;
  const roi = stats?.roi ?? 0;
  const roiFraction = roi / 100;
  const balance = Math.round(STARTING_BALANCE * (1 + roiFraction) * 100) / 100;
  const pnlTotal = Math.round((balance - STARTING_BALANCE) * 100) / 100;
  const dailyRoi = roiFraction / 7;
  const pnlToday = Math.round(STARTING_BALANCE * dailyRoi * 100) / 100;
  const winRate = stats?.win_rate ?? 0;
  const totalTrades = stats?.total_trades ?? 0;
  const tradesToday = Math.round(totalTrades / 7);
  const now = Date.now();
  const lastActive = stats?.last_active ? new Date(stats.last_active).getTime() : 0;
  const isActive = lastActive > 0 && now - lastActive < 24 * 60 * 60 * 1000;
  const seed = parseInt(wallet.address.slice(2, 10), 16);
  const equity = storedEquity && storedEquity.length > 2
    ? storedEquity
    : generateSyntheticEquity(balance, winRate, seed);
  return { address: wallet.address, name: wallet.name, stats, balance, pnlTotal, pnlToday, roi, tradesTotal: totalTrades, tradesToday, winRate, isActive, equity };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtRelTime(unixSec: number): string {
  const diffMs = Date.now() - unixSec * 1000;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// ─── Shared UI primitives ────────────────────────────────────────────────────

function PnlText({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`${value >= 0 ? "text-emerald-400" : "text-rose-400"} ${className}`}>{fmtUsd(value)}</span>;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${active ? "bg-emerald-900/60 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
      {active ? "● Active" : "○ Inactive"}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: TradeOutcome }) {
  const styles: Record<TradeOutcome, string> = {
    WIN: "bg-emerald-900/60 text-emerald-300",
    LOSS: "bg-rose-900/60 text-rose-300",
    PENDING: "bg-gray-800 text-gray-400",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${styles[outcome]}`}>
      {outcome}
    </span>
  );
}

function SideBadge({ side }: { side: "YES" | "NO" }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${side === "YES" ? "bg-emerald-900/50 text-emerald-400" : "bg-rose-900/50 text-rose-400"}`}>
      {side}
    </span>
  );
}

function MiniChart({ data, positive }: { data: EquityPoint[]; positive: boolean }) {
  const formatted = data.map((p) => ({
    t: new Date(p.t).toLocaleTimeString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    v: p.v,
  }));
  const color = positive ? "#34d399" : "#f87171";
  return (
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={formatted} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${positive}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis domain={["auto", "auto"]} hide />
        <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, fontSize: 11 }} labelStyle={{ color: "#888" }} formatter={(v) => [fmtUsd(Number(v)), "Balance"]} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#grad-${positive})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Wallet cards (real trade data preferred, Falcon as fallback) ─────────────

function WalletCard({ wallet, summary, loading }: { wallet: WalletState; summary?: WalletSummary; loading: boolean }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const hasReal = !!summary && summary.trades.length > 0;

  const isActive = hasReal
    ? summary!.trades[0].timestamp > nowSec - 86400
    : wallet.isActive;

  const balance = hasReal ? summary!.balance : wallet.balance;
  const pnlTotal = hasReal ? summary!.balance - STARTING_BALANCE : wallet.pnlTotal;
  const roi = hasReal ? ((summary!.balance / STARTING_BALANCE) - 1) * 100 : wallet.roi;

  const resolved = hasReal ? summary!.trades.filter((t) => t.outcome !== "PENDING") : [];
  const winRate = resolved.length > 0
    ? resolved.filter((t) => t.outcome === "WIN").length / resolved.length
    : wallet.winRate;

  const todayTrades = hasReal ? summary!.trades.filter((t) => t.timestamp >= todayStart) : [];
  const tradesToday = hasReal ? todayTrades.length : wallet.tradesToday;
  const pnlToday = hasReal
    ? todayTrades.filter((t) => t.outcome !== "PENDING").reduce((s, t) => s + t.pnl, 0)
    : wallet.pnlToday;

  const pendingCapital = summary?.pendingCapital ?? 0;
  const pnlPositive = pnlTotal >= 0;

  return (
    <div className="bg-[#141414] border border-gray-800 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-white font-semibold text-base">{wallet.name}</h3>
          <p className="text-gray-600 text-xs font-mono mt-0.5">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge active={isActive} />
          {loading && <span className="text-xs text-gray-600 animate-pulse">Refreshing…</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            label: "Copy Balance",
            el: (
              <div>
                <p className="font-bold text-base text-white">{fmtUsd(balance)}</p>
                {pendingCapital > 0 && (
                  <p className="text-gray-600 text-xs mt-0.5">{fmtUsd(pendingCapital)} in play</p>
                )}
              </div>
            ),
          },
          { label: "Total PnL", el: <PnlText value={pnlTotal} className="font-bold text-lg" /> },
          { label: "ROI", value: fmtPct(roi), color: roi >= 0 ? "text-emerald-400" : "text-rose-400" },
          { label: "PnL Today", el: <PnlText value={pnlToday} className="font-bold text-base" /> },
          { label: "Trades Today", value: String(tradesToday), color: "text-white" },
          { label: "Win Rate", value: `${(winRate * 100).toFixed(1)}%`, color: "text-white" },
        ].map(({ label, value, el, color }) => (
          <div key={label} className="bg-[#0d0d0d] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            {el ?? <p className={`font-bold text-base ${color}`}>{value}</p>}
          </div>
        ))}
      </div>
      <div>
        <p className="text-gray-600 text-xs mb-2">7-Day Equity Curve</p>
        <MiniChart data={wallet.equity} positive={pnlPositive} />
      </div>
    </div>
  );
}

function CombinedCard({ wallets, summaries, loading }: { wallets: WalletState[]; summaries: WalletSummary[]; loading: boolean }) {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const hasReal = summaries.length > 0;

  const totalBalance = hasReal
    ? summaries.reduce((s, w) => s + w.balance, 0)
    : wallets.reduce((s, w) => s + w.balance, 0);
  const totalPnl = totalBalance - STARTING_BALANCE * wallets.length;
  const totalRoi = (totalPnl / (STARTING_BALANCE * wallets.length)) * 100;

  const todayTrades = hasReal ? summaries.flatMap((s) => s.trades.filter((t) => t.timestamp >= todayStart)) : [];
  const totalTrades = hasReal ? todayTrades.length : wallets.reduce((s, w) => s + w.tradesToday, 0);

  const allResolved = hasReal ? summaries.flatMap((s) => s.trades.filter((t) => t.outcome !== "PENDING")) : [];
  const avgWinRate = allResolved.length > 0
    ? allResolved.filter((t) => t.outcome === "WIN").length / allResolved.length
    : wallets.reduce((s, w) => s + w.winRate, 0) / wallets.length;

  const pnlPositive = totalPnl >= 0;
  const combinedEquity: EquityPoint[] = [];
  if (wallets.every((w) => w.equity.length > 0)) {
    const len = Math.min(...wallets.map((w) => w.equity.length));
    for (let i = 0; i < len; i++) {
      combinedEquity.push({ t: wallets[0].equity[i].t, v: wallets.reduce((s, w) => s + (w.equity[i]?.v ?? 0), 0) });
    }
  }
  return (
    <div className="bg-[#1a1a2e] border border-indigo-900/50 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-indigo-300 font-bold text-base">Combined Portfolio</h3>
          <p className="text-gray-500 text-xs mt-0.5">All 3 wallets · {fmtUsd(STARTING_BALANCE * 3)} deployed</p>
        </div>
        {loading && <span className="text-xs text-gray-600 animate-pulse">Refreshing…</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Balance", value: fmtUsd(totalBalance), color: "text-white text-xl" },
          { label: "Total PnL", el: <p className={`font-bold text-xl ${pnlPositive ? "text-emerald-400" : "text-rose-400"}`}>{fmtUsd(totalPnl)}</p> },
          { label: "Portfolio ROI", value: fmtPct(totalRoi), color: `font-bold text-xl ${totalRoi >= 0 ? "text-emerald-400" : "text-rose-400"}` },
          { label: "Trades Today", value: String(totalTrades), color: "text-white text-lg" },
          { label: "Avg Win Rate", value: `${(avgWinRate * 100).toFixed(1)}%`, color: "text-white text-lg" },
          { label: "Capital Deployed", value: fmtUsd(STARTING_BALANCE * 3), color: "text-indigo-300 text-lg" },
        ].map(({ label, value, el, color }) => (
          <div key={label} className="bg-[#0d0d1a] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">{label}</p>
            {el ?? <p className={`font-bold ${color}`}>{value}</p>}
          </div>
        ))}
      </div>
      {combinedEquity.length > 0 && (
        <div>
          <p className="text-gray-600 text-xs mb-2">Combined Equity Curve</p>
          <MiniChart data={combinedEquity} positive={pnlPositive} />
        </div>
      )}
    </div>
  );
}

// ─── Trade Feed ──────────────────────────────────────────────────────────────

function TradeRow({ trade }: { trade: TrackedTrade }) {
  return (
    <tr className="border-b border-gray-900 hover:bg-gray-900/30 transition-colors">
      <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap">{fmtRelTime(trade.timestamp)}</td>
      <td className="py-2 px-3">
        <span className="text-xs font-medium text-gray-300">{trade.walletName}</span>
      </td>
      <td className="py-2 px-3 max-w-[220px]">
        <span className="text-xs text-gray-400 truncate block" title={trade.market}>{trade.market}</span>
      </td>
      <td className="py-2 px-3"><SideBadge side={trade.side} /></td>
      <td className="py-2 px-3 text-xs text-gray-300 text-right">{trade.pricePercent}¢</td>
      <td className="py-2 px-3 text-xs text-gray-300 text-right">{fmtUsd(trade.size)}</td>
      <td className="py-2 px-3 text-xs text-gray-400 text-right">{fmtUsd(trade.copySize)}</td>
      <td className="py-2 px-3 text-xs text-gray-500 text-right">{fmtUsd(trade.fee)}</td>
      <td className="py-2 px-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <OutcomeBadge outcome={trade.outcome} />
          {trade.outcome !== "PENDING" && (
            <span className={`text-xs font-medium ${trade.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {trade.pnl >= 0 ? "+" : ""}{fmtUsd(trade.pnl)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function TradeFeedSection({ summaries, loading }: { summaries: WalletSummary[]; loading: boolean }) {
  // Merge trades from all wallets (last 20 per wallet = up to 60 total), sort by time desc
  const allTrades: TrackedTrade[] = summaries.flatMap((s) => s.trades.slice(0, 20));
  allTrades.sort((a, b) => b.timestamp - a.timestamp);

  const totalVolume = summaries.reduce((s, w) => s + w.volume, 0);
  const totalAffiliate = summaries.reduce((s, w) => s + w.affiliateFees, 0);
  const totalFees = summaries.reduce((s, w) => s + w.totalCopyFees, 0);
  const totalRealizedPnl = summaries.reduce((s, w) => s + w.realizedPnl, 0);
  const pendingCount = summaries.reduce((s, w) => s + w.trades.filter((t) => t.outcome === "PENDING").length, 0);

  return (
    <div className="bg-[#141414] border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-white font-bold text-base">Live Trade Feed</h2>
            <p className="text-gray-500 text-xs mt-0.5">Real trades detected via Data API · {allTrades.length} logged</p>
          </div>
          {loading && <span className="text-xs text-gray-600 animate-pulse">Polling…</span>}
        </div>

        {/* Summary stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[#0d0d0d] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">Total Volume</p>
            <p className="text-white font-bold text-base">{fmtUsd(totalVolume)}</p>
          </div>
          <div className="bg-[#0d0d0d] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">Realized PnL</p>
            <p className={`font-bold text-base ${totalRealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {totalRealizedPnl >= 0 ? "+" : ""}{fmtUsd(totalRealizedPnl)}
            </p>
          </div>
          <div className="bg-[#0d0d0d] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">Fees Paid</p>
            <p className="text-rose-400 font-bold text-base">-{fmtUsd(totalFees)}</p>
          </div>
          <div className="bg-[#0d0d0d] rounded-xl p-3">
            <p className="text-gray-500 text-xs mb-1">Affiliate Earned</p>
            <p className="text-indigo-300 font-bold text-base">{fmtUsd(totalAffiliate)}</p>
            <p className="text-gray-600 text-xs mt-0.5">0.54% of vol</p>
          </div>
        </div>

        {/* Per-wallet running stats */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {summaries.map((s) => (
            <div key={s.address} className="bg-[#0d0d0d] rounded-xl p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-gray-400 text-xs font-medium">{s.name}</p>
                <p className="text-gray-600 text-xs font-mono">{s.address.slice(0, 6)}…{s.address.slice(-4)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500 text-xs">Copy balance</p>
                <p className={`font-bold text-sm ${s.balance >= STARTING_BALANCE ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmtUsd(s.balance)}
                </p>
                <p className="text-gray-600 text-xs">{s.trades.length} trades · {s.trades.filter(t => t.outcome === "PENDING").length} pending</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trade table */}
      {allTrades.length === 0 ? (
        <div className="p-8 text-center text-gray-600 text-sm">
          {loading ? "Fetching trades…" : "No trades detected yet. Polling every 60s."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-600 text-xs">
                <th className="py-2 px-3 text-left font-medium">Time</th>
                <th className="py-2 px-3 text-left font-medium">Wallet</th>
                <th className="py-2 px-3 text-left font-medium">Market</th>
                <th className="py-2 px-3 text-left font-medium">Side</th>
                <th className="py-2 px-3 text-right font-medium">Price</th>
                <th className="py-2 px-3 text-right font-medium">Size</th>
                <th className="py-2 px-3 text-right font-medium">Copy</th>
                <th className="py-2 px-3 text-right font-medium">Fee</th>
                <th className="py-2 px-3 text-right font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {allTrades.map((t) => <TradeRow key={t.id} trade={t} />)}
            </tbody>
          </table>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="p-3 border-t border-gray-800 text-gray-600 text-xs text-center">
          {pendingCount} pending trade{pendingCount > 1 ? "s" : ""} · outcomes resolve when markets close
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ──────────────────────────────────────────────────────────

export default function PaperTradingDashboard() {
  // Falcon stats state (existing)
  const [wallets, setWallets] = useState<WalletState[]>(() =>
    WALLETS.map((w) => ({ ...w, stats: null, balance: STARTING_BALANCE, pnlTotal: 0, pnlToday: 0, roi: 0, tradesTotal: 0, tradesToday: 0, winRate: 0, isActive: false, equity: [] }))
  );
  const [falconLoading, setFalconLoading] = useState(true);
  const equityHistoryRef = useRef<Record<string, EquityPoint[]>>({});

  // Trade tracker state
  const [tradeSummaries, setTradeSummaries] = useState<WalletSummary[]>([]);
  const [tradeLoading, setTradeLoading] = useState(true);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);

  const loadStoredEquity = useCallback((address: string): EquityPoint[] | null => {
    if (typeof window === "undefined") return null;
    try { const s = sessionStorage.getItem(`pt-equity-${address}`); return s ? JSON.parse(s) : null; } catch { return null; }
  }, []);

  const saveEquity = useCallback((address: string, points: EquityPoint[]) => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem(`pt-equity-${address}`, JSON.stringify(points.slice(-200))); } catch { /* ignore */ }
  }, []);

  const fetchFalcon = useCallback(async () => {
    setFalconLoading(true);
    try {
      const res = await fetch("/api/paper-trading");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WalletData[] = await res.json();
      setWallets((prev) =>
        data.map((wd, i) => {
          const stored = equityHistoryRef.current[wd.address] ?? loadStoredEquity(wd.address);
          const state = computeWalletState(wd, stored);
          const now = Date.now();
          const updatedEquity: EquityPoint[] = [...(stored && stored.length > 0 ? stored : state.equity.slice(0, -1)), { t: now, v: state.balance }];
          equityHistoryRef.current[wd.address] = updatedEquity;
          saveEquity(wd.address, updatedEquity);
          return { ...state, equity: updatedEquity, name: prev[i]?.name ?? state.name };
        })
      );
    } catch (err) {
      console.error("[paper-trading] falcon error:", err);
    } finally {
      setFalconLoading(false);
    }
  }, [loadStoredEquity, saveEquity]);

  const fetchTrades = useCallback(async () => {
    setTradeLoading(true);
    setTradeError(null);
    try {
      const res = await fetch("/api/trades");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "unknown error");
      setTradeSummaries(data.summaries ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      setTradeError(String(err));
      console.error("[paper-trading] trades error:", err);
    } finally {
      setTradeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFalcon();
    fetchTrades();
    const interval = setInterval(() => { fetchFalcon(); fetchTrades(); }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchFalcon, fetchTrades]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown((c) => (c <= 1 ? REFRESH_INTERVAL / 1000 : c - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => { if (lastUpdated) setCountdown(REFRESH_INTERVAL / 1000); }, [lastUpdated]);

  const loading = falconLoading || tradeLoading;
  const loaded = !falconLoading || wallets.some((w) => w.stats !== null);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Paper Trading Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">
              Copy-trading 3 Polymarket wallets · {fmtUsd(STARTING_BALANCE)} starting balance each · polling every 60s
            </p>
          </div>
          <div className="text-right">
            {lastUpdated && <p className="text-gray-500 text-xs">Updated {lastUpdated.toLocaleTimeString()}</p>}
            <p className="text-gray-600 text-xs mt-0.5">
              {loading ? "Refreshing now…" : `Next refresh in ${countdown}s`}
            </p>
          </div>
        </div>

        {tradeError && (
          <div className="mb-4 p-3 bg-rose-900/30 border border-rose-800 rounded-xl text-rose-300 text-sm">
            Trade tracker error: {tradeError}
          </div>
        )}

        {!loaded ? (
          <div className="flex items-center justify-center py-24 text-gray-500">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-gray-700 border-t-indigo-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Fetching wallet data…</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {wallets.map((w) => (
                <WalletCard
                  key={w.address}
                  wallet={w}
                  summary={tradeSummaries.find((s) => s.address === w.address)}
                  loading={falconLoading || tradeLoading}
                />
              ))}
            </div>
            <CombinedCard wallets={wallets} summaries={tradeSummaries} loading={falconLoading || tradeLoading} />
            <TradeFeedSection summaries={tradeSummaries} loading={tradeLoading} />
          </div>
        )}
      </div>
    </main>
  );
}
