"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/feedback";
import { whatsappChatUrl } from "@/lib/whatsapp-share";
import { rotateVendorPortalTokenAction } from "../../actions";

/**
 * The link the vendor gets, and the button that kills it.
 *
 * Shown in full rather than masked: the entire point is that ops can
 * read it out, message it, or scan it onto the vendor's phone while
 * sitting with them. Masking a credential you exist to hand over just
 * adds a step.
 */
export function PortalLink({
  vendorId,
  businessName,
  ownerName,
  whatsappNumber,
  token,
  rotatedAt,
}: {
  vendorId: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  token: string;
  rotatedAt: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [ask, askDialog] = useConfirm();

  // Built in the browser so it matches wherever this is actually
  // served, rather than hardcoding a domain that would be wrong in
  // local development and on every preview deployment.
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/vendor/${token}`;

  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-semibold">Their counter link</h2>
        <p className="text-zinc-600">
          Open this once on the phone they&rsquo;ll use at the counter, then bookmark it. It lets
          them check and confirm codes for the gifts they sell — nothing else.
        </p>
      </div>

      {link && (
        <a
          href={whatsappChatUrl(whatsappNumber, counterLinkMessage(ownerName, businessName, link))}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start rounded bg-zinc-900 px-4 py-2 font-medium text-white"
        >
          Send to {firstName(ownerName)} on WhatsApp
        </a>
      )}
      <p className="text-xs text-zinc-500">
        Opens a chat with {whatsappNumber}, the link and how to use it already written. Send it only to
        that number — anyone holding this link can confirm collections for {businessName}.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs whitespace-nowrap">
          {link || "…"}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="rounded border border-zinc-300 px-3 py-2"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            const ok = await ask({
              title: "Issue a new link?",
              body: "Their current link stops working immediately. They'll need the new one to see orders, collect or deliver anything.",
              confirmLabel: "Issue new link",
              tone: "danger",
            });
            if (!ok) return;
            setErrors([]);
            setNotice(null);
            startTransition(async () => {
              const result = await rotateVendorPortalTokenAction(vendorId);
              if (result.ok) setNotice(result.message ?? "New link issued.");
              else setErrors(result.errors);
            });
          }}
          className="rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50"
        >
          {pending ? "Issuing…" : "Replace link"}
        </button>
        <span className="text-xs text-zinc-500">
          {rotatedAt
            ? `Last replaced ${new Date(rotatedAt).toLocaleDateString("en-NG", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}.`
            : "Use this if the phone is lost or a staff member leaves."}
        </span>
      </div>

      {notice && (
        <p role="status" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          {notice} Reload to see the new link.
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded border border-red-300 bg-red-50 py-2 pr-3 pl-8 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {askDialog}
    </section>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Written for someone reading it on the phone they'll use at the
 * counter: what the link is, the one-time setup, the two steps per
 * customer, and the one rule.
 */
function counterLinkMessage(ownerName: string, businessName: string, link: string): string {
  return [
    `Hi ${firstName(ownerName)}, here is the SendEbun counter link for ${businessName}:`,
    "",
    link,
    "",
    "Open it once on the phone you'll use at the counter, then bookmark it.",
    "First time: tap Shop to add your address, opening hours and bank details, then Items to add what you sell, with a photo of each.",
    "When a customer books a pickup, it shows under Coming in — tap Got it so they know it'll be ready.",
    "When a customer shows a SendEbun gift: tap Scan their QR (or type their code), check the gift, then tap Hand it over.",
    "",
    "Please keep this link to yourselves — it confirms collections for your shop.",
  ].join("\n");
}
