import { redirect } from "next/navigation";

/**
 * Orders, not vendors. Vendors was the landing page only because it was
 * the first screen that existed — the question someone opens /ops to
 * answer is almost always about a specific order, and the stuck-order
 * banner lives there.
 */
export default function OpsIndex() {
  redirect("/ops/orders");
}
