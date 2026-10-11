import { RedeemConsole } from "./redeem-console";

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
      <h1 className="mb-1 text-lg font-semibold">Collect a gift</h1>
      <p className="mb-6 text-zinc-600">
        Type the code on the recipient&rsquo;s screen, check it matches what they&rsquo;re
        collecting, then confirm.
      </p>
      <RedeemConsole />
    </>
  );
}
