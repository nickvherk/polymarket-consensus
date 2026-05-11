import { NextResponse } from "next/server";
import { pollAndUpdate, resetWallet } from "@/lib/tradeTracker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summaries = await pollAndUpdate();
    return NextResponse.json({ summaries, ok: true, ts: Date.now() });
  } catch (err) {
    console.error("[api/trades] error:", err);
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === "reset" && typeof body.wallet === "string") {
      const ok = resetWallet(body.wallet);
      return NextResponse.json({ ok, wallet: body.wallet });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err), ok: false }, { status: 500 });
  }
}
