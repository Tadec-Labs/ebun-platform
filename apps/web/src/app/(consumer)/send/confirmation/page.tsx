import type { Metadata } from "next";
import { ConfirmationExperience } from "./confirmation-experience";

export const metadata: Metadata = {
  title: "Payment — Ebun",
  // A per-order, transient page reached from Paystack's redirect —
  // nothing here belongs in a search index.
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({
  searchParams,
}: PageProps<"/send/confirmation">) {
  const params = await searchParams;
  // Paystack sends both `reference` and `trxref` (same value); accept either.
  const raw = params.reference ?? params.trxref;
  const reference = Array.isArray(raw) ? raw[0] : raw;

  return <ConfirmationExperience reference={reference ?? null} />;
}
