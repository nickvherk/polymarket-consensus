import { NextResponse } from "next/server";
import { fetchWallet360 } from "@/lib/falcon";

const WALLETS = [
  { address: "0x6e1d5040d0ac73709b0621f620d2a60b80d2d0fa", name: "High Frequency" },
  { address: "0x7dfcf54ea9b8e90e69af427e87e652e8aab2da6e", name: "Asymmetric" },
  { address: "0x06dc51826bc524d9a83770e7de9dd7e005b04524", name: "High Precision" },
];

export async function GET() {
  const results = await Promise.allSettled(
    WALLETS.map(async (w) => {
      const stats = await fetchWallet360(w.address);
      return { ...w, stats };
    })
  );

  const data = results.map((r, i) => ({
    address: WALLETS[i].address,
    name: WALLETS[i].name,
    stats: r.status === "fulfilled" ? r.value.stats : null,
    error: r.status === "rejected" ? String(r.reason) : null,
  }));

  return NextResponse.json(data);
}
