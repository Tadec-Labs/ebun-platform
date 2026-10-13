import type { Metadata } from "next";
import { PageHeader } from "@/components/ops/ui";
import { RedeemConsole } from "./redeem-console";

export const metadata: Metadata = { title: "Redeem a code" };

/**
 * The vendor choices now come with each code lookup, not from the full
 * vendor list: only an active vendor that sells THAT gift can be
 * credited with handing it over, and the API enforces the same rule.
 * Listing every vendor let a collection be recorded against a business
 * that had never agreed a price for the gift.
 */
export default function RedeemPage() {
  return (
    <>
      <PageHeader
        title="Redeem a code"
        description="Type the code on the recipient’s screen, check it matches what they’re collecting, then confirm."
      />
      <RedeemConsole />
    </>
  );
}
