export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { pollAndUpdate } = await import("./lib/tradeTracker");
  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Initial poll so data is fresh on first page load
  pollAndUpdate().catch((err) =>
    console.error("[poller] startup poll failed:", err)
  );

  setInterval(() => {
    pollAndUpdate().catch((err) =>
      console.error("[poller] interval poll failed:", err)
    );
  }, INTERVAL_MS);
}
