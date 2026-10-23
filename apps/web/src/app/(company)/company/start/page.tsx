import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { corporateSelfServeEnabled } from "@/lib/feature-flags";
import { StartForm } from "./start-form";

export const metadata: Metadata = {
  title: "Gifts for your team, clients or customers — SendEbun for companies",
  description:
    "Send every person a real gift and one message from you. They choose the gift; you pay once and only for gifts people claim.",
  // The one public page under /company: unlike the private links, this
  // should be found.
  robots: { index: true, follow: true },
};

/**
 * The public front door for companies. Everything after the form is the
 * existing private-link portal; this page only gets the link to them.
 */
export default function CompanyStartPage() {
  if (!corporateSelfServeEnabled()) notFound();

  return (
    <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-start">
      <section className="flex flex-col gap-5">
        <p className="text-xs font-medium tracking-widest text-amber-700 uppercase">For companies</p>
        <h1 className="text-3xl leading-tight font-semibold text-zinc-900">
          A real gift for everyone on your list, with a message from you.
        </h1>
        <p className="text-base leading-relaxed text-zinc-600">
          Staff at year end, clients after a good quarter, your best customers. Upload the list, record one message,
          offer up to three gifts — each person picks the one they want.
        </p>
        <ul className="flex flex-col gap-3 text-zinc-700">
          <Point title="They choose">Meals, cakes, pampering, cinema — collected nearby or delivered.</Point>
          <Point title="One message, every person">Voice, video or written, from you or your CEO.</Point>
          <Point title="Pay once, for what's claimed">Unclaimed gifts come back to you as credit.</Point>
          <Point title="See it land">Who opened, who enjoyed it, and their thank-you notes, live.</Point>
        </ul>
        <p className="text-sm text-zinc-500">
          Booking now for December. Questions first?{" "}
          <a href="mailto:hello@ebun.com.ng" className="font-medium text-zinc-900 underline underline-offset-2">
            hello@ebun.com.ng
          </a>
        </p>
      </section>

      <StartForm />
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
      <span>
        <span className="font-medium text-zinc-900">{title}.</span> {children}
      </span>
    </li>
  );
}
