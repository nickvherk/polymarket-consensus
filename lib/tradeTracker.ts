const DATA_API = "https://data-api.polymarket.com";

export const STARTING_BALANCE = 1000;
const FEE_RATE = 0.018;
const AFFILIATE_RATE = 0.0054; // 30% of 1.8% fee
const MAX_TRADES_PER_WALLET = 500;
// Single trade is capped at this fraction of current portfolio balance.
// At $1,000 starting balance this gives a $50 max position.
const MAX_COPY_PCT = 0.05;
// Trades older than this before startup are marked seen but not copied, so
// the historical backfill on first poll doesn't exhaust the $1000 balance.
const COPY_LOOKBACK_SEC = 3600; // 1 hour

export const TRACKED_WALLETS = [
  { address: "0x6e1d5040d0ac73709b0621f620d2a60b80d2d0fa", name: "High Frequency" },
  { address: "0x7dfcf54ea9b8e90e69af427e87e652e8aab2da6e", name: "Asymmetric" },
  { address: "0x06dc51826bc524d9a83770e7de9dd7e005b04524", name: "High Precision" },
];

export type TradeOutcome = "WIN" | "LOSS" | "PENDING";

export interface TrackedTrade {
  id: string;
  timestamp: number;       // unix seconds
  walletAddress: string;
  walletName: string;
  market: string;
  conditionId: string;
  side: "YES" | "NO";
  pricePercent: number;    // price * 100 (e.g. 92 = 92¢)
  price: number;           // 0–1
  size: number;            // USDC amount of original trade
  fee: number;             // 1.8% of size
  copySize: number;        // USDC we allocated for the copy trade
  copyFee: number;         // 1.8% of copySize
  outcome: TradeOutcome;
  pnl: number;             // realized net PnL after fees (0 while PENDING)
}

interface WalletStore {
  address: string;
  name: string;
  trades: TrackedTrade[];
  seenHashes: string[];
  lastPolled: number;     // unix seconds of last successful fetch
  totalDetected: number;  // cumulative new tx hashes seen since startup
}

interface TradesStore {
  wallets: Record<string, WalletStore>;
  lastUpdated: number;
  startedAt: number;  // unix seconds when the in-memory store was created
}

interface DataApiTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  outcome: string;  // "Yes" | "No"
  price: number;
  size: number;
  timestamp: number;
  title: string;
  conditionId: string;
  transactionHash: string;
}

// In-memory store — survives between requests within one process instance.
// Data is lost on restart, but seenHashes reset too so all recent trades
// are re-detected on the first poll after startup.
let _store: TradesStore | null = null;

function initStore(): TradesStore {
  const wallets: Record<string, WalletStore> = {};
  for (const w of TRACKED_WALLETS) {
    wallets[w.address] = {
      address: w.address,
      name: w.name,
      trades: [],
      seenHashes: [],
      lastPolled: 0,
      totalDetected: 0,
    };
  }
  return { wallets, lastUpdated: 0, startedAt: Math.floor(Date.now() / 1000) };
}

function getStore(): TradesStore {
  if (!_store) _store = initStore();
  return _store;
}

async function fetchLatestTrades(walletAddress: string): Promise<DataApiTrade[]> {
  const res = await fetch(`${DATA_API}/trades?user=${walletAddress}&limit=200`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Data API ${res.status}`);
  return res.json();
}

const CLOB_API = "https://clob.polymarket.com";

async function resolveCondition(conditionId: string): Promise<{ resolved: boolean; winningOutcome?: string }> {
  try {
    const res = await fetch(`${CLOB_API}/markets/${conditionId}`, { cache: "no-store" });
    if (!res.ok) return { resolved: false };
    const market = await res.json();
    const tokens: Array<{ outcome: string; winner: boolean }> = market?.tokens ?? [];
    const winner = tokens.find((t) => t.winner === true);
    if (!winner) return { resolved: false };
    return { resolved: true, winningOutcome: winner.outcome };
  } catch {
    return { resolved: false };
  }
}

export interface WalletSummary {
  address: string;
  name: string;
  balance: number;
  realizedPnl: number;
  pendingCapital: number;
  volume: number;
  affiliateFees: number;
  totalCopyFees: number;
  trades: TrackedTrade[];
  lastPolled: number;
  totalDetected: number;
}

function computeSummary(ws: WalletStore): WalletSummary {
  const resolved = ws.trades.filter((t) => t.outcome !== "PENDING");
  const pending = ws.trades.filter((t) => t.outcome === "PENDING");
  const realizedPnl = resolved.reduce((s, t) => s + t.pnl, 0);
  const pendingCapital = pending.reduce((s, t) => s + t.copySize + t.copyFee, 0);
  const balance = STARTING_BALANCE + realizedPnl;
  const volume = ws.trades.reduce((s, t) => s + t.size, 0);
  const totalCopyFees = ws.trades.reduce((s, t) => s + t.copyFee, 0);
  return {
    address: ws.address,
    name: ws.name,
    balance: Math.round(balance * 100) / 100,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    pendingCapital: Math.round(pendingCapital * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    affiliateFees: Math.round(volume * AFFILIATE_RATE * 100) / 100,
    totalCopyFees: Math.round(totalCopyFees * 100) / 100,
    trades: ws.trades.slice().sort((a, b) => b.timestamp - a.timestamp),
    lastPolled: ws.lastPolled,
    totalDetected: ws.totalDetected,
  };
}

export async function pollAndUpdate(): Promise<WalletSummary[]> {
  const store = getStore();
  const nowSec = Math.floor(Date.now() / 1000);
  // Only copy trades that occurred within COPY_LOOKBACK_SEC before startup.
  // Historical trades beyond that window are marked seen to prevent re-detection
  // but are NOT copied — this avoids exhausting the balance on the first poll.
  const copyThresholdSec = store.startedAt - COPY_LOOKBACK_SEC;

  for (const wallet of TRACKED_WALLETS) {
    const ws = store.wallets[wallet.address];
    let rawTrades: DataApiTrade[] = [];

    try {
      rawTrades = await fetchLatestTrades(wallet.address);
      console.log(`[tradeTracker] ${wallet.name}: fetched ${rawTrades.length} trades`);
      ws.lastPolled = nowSec;
    } catch (err) {
      console.error(`[tradeTracker] ${wallet.name} fetch error:`, err);
      continue;
    }

    const newTrades = rawTrades
      .filter((t) => !ws.seenHashes.includes(t.transactionHash))
      .sort((a, b) => a.timestamp - b.timestamp); // oldest first

    ws.totalDetected += newTrades.length;

    if (newTrades.length > 0) {
      const copyable = newTrades.filter((t) => t.side === "BUY" && t.timestamp >= copyThresholdSec);
      console.log(
        `[tradeTracker] ${wallet.name}: ${newTrades.length} new (${copyable.length} copyable, threshold ${copyThresholdSec})`
      );
    }

    // Free cash = settled balance minus capital already in pending positions
    const currentSummary = computeSummary(ws);
    let availableBalance = currentSummary.balance - currentSummary.pendingCapital;

    for (const raw of newTrades) {
      ws.seenHashes.push(raw.transactionHash);

      // Only copy BUY trades; skip SELLs
      if (raw.side !== "BUY") continue;

      // Skip historical trades to avoid exhausting the balance on first-poll backfill
      if (raw.timestamp < copyThresholdSec) continue;

      const side: "YES" | "NO" = raw.outcome.toLowerCase() === "yes" ? "YES" : "NO";
      // Cap to 5% of current portfolio balance or available cash, whichever is smaller.
      // This prevents a single large trade from wiping the simulation balance.
      const positionBudget = Math.min(availableBalance, currentSummary.balance * MAX_COPY_PCT);
      const maxCopy = positionBudget / (1 + FEE_RATE);
      const copySize = Math.min(raw.size, Math.max(maxCopy, 0));
      if (copySize < 0.01) {
        console.log(`[tradeTracker] ${wallet.name}: skipping trade — balance exhausted (available: ${availableBalance.toFixed(2)})`);
        continue;
      }

      const copyFee = Math.round(copySize * FEE_RATE * 100) / 100;
      availableBalance -= copySize + copyFee;

      ws.trades.push({
        id: raw.transactionHash,
        timestamp: raw.timestamp,
        walletAddress: wallet.address,
        walletName: wallet.name,
        market: raw.title,
        conditionId: raw.conditionId,
        side,
        pricePercent: Math.round(raw.price * 100),
        price: raw.price,
        size: raw.size,
        fee: Math.round(raw.size * FEE_RATE * 100) / 100,
        copySize,
        copyFee,
        outcome: "PENDING",
        pnl: 0,
      });
    }

    // Cap stored trades to avoid unbounded memory growth
    if (ws.trades.length > MAX_TRADES_PER_WALLET) {
      ws.trades = ws.trades.slice(-MAX_TRADES_PER_WALLET);
    }

    // Cap seenHashes to avoid unbounded growth
    if (ws.seenHashes.length > 2000) ws.seenHashes = ws.seenHashes.slice(-1000);
  }

  // Resolve PENDING trades — check all unique pending conditions in parallel
  const pendingConditions = new Set<string>();
  for (const ws of Object.values(store.wallets)) {
    for (const t of ws.trades) {
      if (t.outcome === "PENDING") pendingConditions.add(t.conditionId);
    }
  }

  if (pendingConditions.size > 0) {
    console.log(`[tradeTracker] Resolving ${pendingConditions.size} pending condition(s)`);
  }

  const resolutionMap = new Map<string, { resolved: boolean; winningOutcome?: string }>();
  await Promise.all(
    [...pendingConditions].map(async (condId) => {
      const result = await resolveCondition(condId);
      resolutionMap.set(condId, result);
      if (result.resolved) {
        console.log(`[tradeTracker] Condition ${condId.slice(0, 10)}… resolved → ${result.winningOutcome}`);
      }
    })
  );

  for (const ws of Object.values(store.wallets)) {
    for (const trade of ws.trades) {
      if (trade.outcome !== "PENDING") continue;
      const resolution = resolutionMap.get(trade.conditionId);
      if (!resolution?.resolved || !resolution.winningOutcome) continue;

      const won = resolution.winningOutcome.toLowerCase() === trade.side.toLowerCase();
      trade.outcome = won ? "WIN" : "LOSS";
      trade.pnl = won
        ? Math.round(((trade.copySize / trade.price) - trade.copySize - trade.copyFee) * 100) / 100
        : Math.round(-(trade.copySize + trade.copyFee) * 100) / 100;
      console.log(`[tradeTracker] Trade ${trade.id.slice(0, 10)}… → ${trade.outcome} PnL ${trade.pnl}`);
    }
  }

  store.lastUpdated = Date.now();

  return TRACKED_WALLETS.map((w) => computeSummary(store.wallets[w.address]));
}

export function getStoredSummaries(): WalletSummary[] {
  const store = getStore();
  return TRACKED_WALLETS.map((w) => computeSummary(store.wallets[w.address]));
}

// Clears all copied trades for a wallet, resetting its balance to STARTING_BALANCE.
// seenHashes are preserved so already-detected trades are not re-copied on the next poll.
export function resetWallet(address: string): boolean {
  const store = getStore();
  const ws = store.wallets[address];
  if (!ws) return false;
  ws.trades = [];
  ws.totalDetected = 0;
  store.lastUpdated = Date.now();
  return true;
}
