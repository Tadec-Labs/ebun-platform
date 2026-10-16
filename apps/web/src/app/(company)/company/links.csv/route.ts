import { API_BASE_URL } from "@/lib/api-config";
import { getCompanyToken } from "@/lib/company/session";

/**
 * The link sheet download: every person's gift link, for HR to share
 * however they like. Proxied so the token stays in the httpOnly cookie
 * and never reaches page JavaScript.
 */
export async function GET() {
  const token = await getCompanyToken();
  if (!token) return new Response("This link no longer works.", { status: 401 });
  const res = await fetch(`${API_BASE_URL}/company/links.csv`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return new Response("Couldn't build the sheet. Try again.", { status: res.status });
  return new Response(await res.text(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sendebun-gift-links.csv"',
      "Cache-Control": "no-store",
    },
  });
}
