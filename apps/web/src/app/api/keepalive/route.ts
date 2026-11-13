import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "missing env" }, { status: 500 });
  }

  const res = await fetch(`${url}/rest/v1/keepalive?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status }, { status: 500 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}