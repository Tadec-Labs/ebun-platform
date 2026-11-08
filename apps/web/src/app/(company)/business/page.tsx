import type { Metadata } from "next";
import {
  bizFetch,
  type BizCampaign,
  type BizMe,
  type BizMember,
} from "@/lib/business/api";
import { formatNaira } from "@/lib/format-money";
import {
  newCampaignAction,
  openCampaignAction,
  removeMemberAction,
  signOutAction,
} from "./actions";
import { CreateCompanyForm, InviteForm } from "./dashboard-forms";

export const metadata: Metadata = { title: "SendEbun for companies" };

const STATUS: Record<BizCampaign["status"], string> = {
  draft: "Draft",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
};

const dateFmt = new Intl.DateTimeFormat("en-NG", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
});

/**
 * The company's home: its campaigns and its people. Creating or opening
 * a campaign hands over to the existing campaign screen (/company), so
 * list, gifts, message, payment and report work exactly as before.
 */
export default async function BusinessHomePage() {
  const me = await bizFetch<BizMe>("/business/me");

  if (!me.company) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-semibold">Set up your company</h1>
        <p className="mb-6 text-zinc-600">Signed in as {me.email}.</p>
        {me.emailConfirmed ? (
          <CreateCompanyForm />
        ) : (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            Verify your email first: open the link we sent to {me.email}, then
            sign in again.
          </p>
        )}
        <form action={signOutAction} className="mt-8">
          <button className="text-zinc-500 underline">Sign out</button>
        </form>
      </div>
    );
  }

  const [campaigns, members] = await Promise.all([
    bizFetch<BizCampaign[]>("/business/campaigns"),
    bizFetch<BizMember[]>("/business/members"),
  ]);
  const owner = me.role === "owner";

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{me.company.displayName}</h1>
          <p className="text-zinc-500">{me.email}</p>
        </div>
        <form action={newCampaignAction}>
          <button className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
            New campaign
          </button>
        </form>
      </div>

      <section aria-labelledby="campaigns">
        <h2
          id="campaigns"
          className="mb-3 text-xs font-medium tracking-wider text-zinc-500 uppercase"
        >
          Campaigns
        </h2>
        {campaigns.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-zinc-500">
            Your first campaign takes a few minutes: pick gifts, add people, pay
            once.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
            {campaigns.map((c) => (
              <li key={c.id}>
                <form
                  action={openCampaignAction}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="text-zinc-500">
                      {STATUS[c.status]}
                      {c.recipients ? ` · ${c.recipients} people` : ""}
                      {c.amountDue ? ` · ${formatNaira(c.amountDue)}` : ""}
                      {` · ${dateFmt.format(new Date(c.createdAt))}`}
                    </p>
                  </div>
                  {c.status !== "cancelled" && (
                    <button className="shrink-0 rounded border border-zinc-300 px-3 py-1.5">
                      Open
                    </button>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="team">
        <h2
          id="team"
          className="mb-3 text-xs font-medium tracking-wider text-zinc-500 uppercase"
        >
          Team
        </h2>
        <ul className="mb-4 divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="min-w-0 truncate">
                {m.email}
                <span className="text-zinc-500">
                  {m.role === "owner" ? " · Owner" : ""}
                  {m.pending ? " · Invited" : ""}
                  {m.you ? " · You" : ""}
                </span>
              </span>
              {owner && !m.you && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-zinc-500 underline">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {owner && <InviteForm />}
      </section>

      <form action={signOutAction}>
        <button className="text-zinc-500 underline">Sign out</button>
      </form>
    </div>
  );
}
