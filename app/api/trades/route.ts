import { NextResponse } from "next/server";
import { pollAndUpdate } from "@/lib/tradeTracker";

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
