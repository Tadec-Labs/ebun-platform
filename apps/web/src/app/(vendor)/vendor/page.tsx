import { VendorApiError, vendorFetch, type VendorIdentity } from "@/lib/vendor/api";
import { CounterScreen } from "./counter-screen";

export default async function VendorPage() {
  let identity: VendorIdentity;
  try {
    identity = await vendorFetch<VendorIdentity>("/vendor/me");
  } catch (error) {
    if (error instanceof VendorApiError) {
      return <LinkProblem offline={error.status === 0} />;
    }
    throw error;
  }

  return <CounterScreen businessName={identity.businessName} />;
}

/**
 * Two different problems, told apart because the fixes are opposite:
 * one is "wait and try again", the other is "this link is dead, call
 * Ebun". Collapsing them would send a vendor retrying a link that will
 * never work, or phoning about a dropped connection.
 */
function LinkProblem({ offline }: { offline: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold">
        {offline ? "No connection" : "This link isn't working"}
      </h1>
      <p className="text-lg leading-relaxed text-zinc-600">
        {offline
          ? "Check the phone's internet and reload this page."
          : "It may have been replaced. Ask Ebun for a new link, then open it on this phone."}
      </p>
    </div>
  );
}
