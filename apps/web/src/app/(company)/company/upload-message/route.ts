import { API_BASE_URL } from "@/lib/api-config";
import { getCompanyToken } from "@/lib/company/session";

/**
 * Passes the company's recorded message on to the API.
 *
 * A route handler, not a server action: server actions are capped at
 * 2 MB here (next.config.ts), and a 30-second video recorded in the
 * browser is ~3.5 MB. The browser can't call the API itself because the
 * campaign token lives in an httpOnly cookie. Vercel still caps any
 * request at 4.5 MB, which is why the page records in the browser (at a
 * known bitrate) rather than accepting a camera file.
 */
export async function POST(request: Request) {
  const token = await getCompanyToken();
  if (!token) return Response.json({ message: "This link no longer works." }, { status: 401 });

  const form = await request.formData();
  const res = await fetch(`${API_BASE_URL}/company/message`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}
