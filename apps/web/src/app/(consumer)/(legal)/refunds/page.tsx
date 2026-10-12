import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { LegalPage, List, Section } from "../legal-page";

export const metadata: Metadata = {
  title: "Refund policy",
  description: "When SendEbun refunds a gift, how long it takes, and how to ask.",
};

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund policy"
      summary={`If we can't deliver what you paid for, you get your money back in full. Once a gift has been collected or delivered, it's been used — that's when refunds stop.`}
    >
      <Section heading="You get a full refund when">
        <List
          items={[
            "Your payment went through but the gift couldn't be issued — for example, an airtime top-up failed or a voucher couldn't be created.",
            "The place listed for collection can't honour the gift and we can't arrange another one nearby.",
            "You were charged more than once for the same order.",
            `The gift hasn't been opened yet and you ask us to cancel it. Contact us with your order number (it starts with EBN-).`,
            `The recipient doesn't collect it within ${LEGAL.giftValidityDays} days of your payment. We'll refund you, the sender — not the recipient.`,
          ]}
        />
      </Section>

      <Section heading="When we can't refund">
        <List
          items={[
            "A voucher gift that has been collected at the counter.",
            "Airtime, data or electricity that has been delivered to the number or meter you entered — including when the number or meter was entered incorrectly, because the value can't be recovered once it's sent.",
            "A gift link that you forwarded to someone other than the intended recipient, who then opened or collected it. The link is the gift: anyone who has it can open it.",
          ]}
        />
      </Section>

      <Section heading="How refunds are paid">
        <p>
          Refunds go back to the card or account you paid with, through
          Paystack. We refund the full amount you paid. Once we&rsquo;ve
          approved a refund it can take up to {LEGAL.refundWorkingDays} working
          days to appear, depending on your bank.
        </p>
        <p>
          We don&rsquo;t refund in cash, as store credit, or to a different
          account.
        </p>
      </Section>

      <Section heading="If something went wrong at collection">
        <p>
          Vendors are independent businesses. If what was handed over
          wasn&rsquo;t what the gift described, tell us within 7 days of
          collection. We&rsquo;ll take it up with the vendor and, where the
          vendor got it wrong, refund you or arrange a replacement.
        </p>
      </Section>

      <Section heading="How to ask">
        <p>
          Email{" "}
          <a href={`mailto:${LEGAL.email}`} className="underline">
            {LEGAL.email}
          </a>{" "}
          or WhatsApp {LEGAL.phone} with your order number and what happened. We
          reply within 2 working days.
        </p>
        <p>
          This policy is part of our{" "}
          <Link href="/terms" className="underline">
            Terms of service
          </Link>
          . It doesn&rsquo;t affect any rights you have under Nigerian consumer
          protection law.
        </p>
      </Section>
    </LegalPage>
  );
}
