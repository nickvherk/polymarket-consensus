export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  endDate: string;
  outcomes: string; // JSON string e.g. '["Yes","No"]'
  outcomePrices: string; // JSON string e.g. '["0.62","0.38"]'
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  volume24hr: number;
  liquidityNum: number;
}

const GAMMA_API = "https://gamma-api.polymarket.com";

// Word-boundary patterns to avoid partial matches (e.g. "eth" in "Netherlands")
const CRYPTO_PATTERNS = [
  /\bbitcoin\b/i,
  /\bbtc\b/i,
  /\bethereum\b/i,
  /\bether\b/i,
  /\b(?:^|-)eth(?:-|$|\b)/i, // eth as standalone word/slug segment
  /\bsolana\b/i,
  /\bcrypto\b/i,
  /\bblockchain\b/i,
  /\bdefi\b/i,
  /\bnft\b/i,
  /\bstablecoin\b/i,
  /\busdt\b/i,
  /\busdc\b/i,
  /\baltcoin\b/i,
  /megaeth/i,
];

function isCryptoMarket(market: PolymarketMarket): boolean {
  const q = market.question;
  const s = market.slug;
  return CRYPTO_PATTERNS.some((p) => p.test(q) || p.test(s));
}

export async function fetchBitcoinMarkets(): Promise<PolymarketMarket[]> {
  // Fetch a large batch of open markets; the API doesn't support full-text search
  const url = `${GAMMA_API}/markets?active=true&closed=false&limit=1000`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  const allMarkets: PolymarketMarket[] = await res.json();

  const cryptoMarkets = allMarkets.filter(isCryptoMarket);

  console.log("=== POLYMARKET RAW API RESPONSE ===");
  console.log("Query URL:", url);
  console.log(`Total open markets returned: ${allMarkets.length}`);
  console.log(`Crypto markets filtered: ${cryptoMarkets.length}`);
  console.log("Sample market structure (first result):");
  console.log(JSON.stringify(allMarkets[0], null, 2));
  console.log("Crypto markets:");
  console.log(JSON.stringify(cryptoMarkets, null, 2));
  console.log("===================================");

  // Sort by 24h volume descending
  return cryptoMarkets.sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0));
}

export function parseOutcomes(market: PolymarketMarket) {
  try {
    const outcomes: string[] = JSON.parse(market.outcomes);
    const prices: string[] = JSON.parse(market.outcomePrices);
    return outcomes.map((label, i) => ({
      label,
      price: parseFloat(prices[i] ?? "0"),
    }));
  } catch {
    return [];
  }
}
