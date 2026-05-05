import { fetchBitcoinMarkets, parseOutcomes } from "@/lib/polymarket";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function PriceBadge({ label, price }: { label: string; price: number }) {
  const pct = (price * 100).toFixed(1);
  const isYes = label.toLowerCase() === "yes";
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-gray-500 mb-1">{label}</span>
      <span
        className={`text-sm font-semibold px-2 py-0.5 rounded ${
          isYes
            ? "bg-emerald-900/50 text-emerald-400"
            : "bg-rose-900/50 text-rose-400"
        }`}
      >
        {pct}¢
      </span>
    </div>
  );
}

export default async function Home() {
  const markets = await fetchBitcoinMarkets();

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-gray-100 p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          Polymarket Consensus Signal
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Active BTC markets · prices refresh every 30s
        </p>
      </div>

      {markets.length === 0 ? (
        <div className="text-gray-500 text-center py-16">
          No active Bitcoin markets found. Check console for raw API response.
        </div>
      ) : (
        <ul className="space-y-3">
          {markets.map((market) => {
            const outcomes = parseOutcomes(market);
            return (
              <li
                key={market.id}
                className="bg-[#141414] border border-gray-800 rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm font-medium text-gray-100 leading-snug">
                    {market.question}
                  </p>
                  <div className="flex gap-3 shrink-0">
                    {outcomes.map((o) => (
                      <PriceBadge key={o.label} {...o} />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>
                    Vol 24h:{" "}
                    <span className="text-gray-400">
                      $
                      {(market.volume24hr ?? 0).toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </span>
                  <span>
                    Closes{" "}
                    <span className="text-gray-400">
                      {formatDate(market.endDate)}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-xs text-gray-700 text-center">
        Raw API response logged to server console · {markets.length} markets
        loaded
      </p>
    </main>
  );
}
