import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { LegalPage, List, Section } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The agreement between you and SendEbun when you send or receive a gift.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      summary="You pay for a gift; we make sure the person you choose can open it and collect or receive it. These terms cover what each of us is responsible for. Please read them before you pay."
    >
      <Section heading="Who we are">
        <p>
          {LEGAL.brand} is a digital gifting service operated by {LEGAL.entity},{" "}
          {LEGAL.entityDescription}, at {LEGAL.address}. &ldquo;We&rdquo; and
          &ldquo;us&rdquo; mean {LEGAL.entity}. &ldquo;You&rdquo; means the
          person sending a gift, or receiving one where a section says so.
        </p>
        <p>
          By paying for a gift, you agree to these terms, our{" "}
          <Link href="/refunds" className="underline">
            Refund policy
          </Link>{" "}
          and our{" "}
          <Link href="/privacy" className="underline">
            Privacy notice
          </Link>
          .
        </p>
      </Section>

      <Section heading="Sending a gift">
        <List
          items={[
            "You must be 18 or older to buy a gift.",
            "Prices are in Nigerian naira and are shown before you pay. A gift costs what the vendor charges for it in store; our service fee is shown as a separate line, and you pay the total up front.",
            "Payments are processed by Paystack. We never see or store your card details.",
            "An order is confirmed only when Paystack confirms the payment to us — not when your browser returns from the payment page.",
            "You're responsible for the recipient's name and WhatsApp number being correct. Please check them before paying.",
            "By entering someone's details, you confirm they would reasonably expect a gift or message from you.",
          ]}
        />
      </Section>

      <Section heading="The gift link">
        <p>
          Every gift comes with a private link. Whoever has the link can open
          the gift, so send it only to the person it&rsquo;s for. We can&rsquo;t
          tell who is holding a link, and we aren&rsquo;t responsible for a gift
          opened by someone you forwarded it to.
        </p>
        <p>
          Your message is shown to the recipient when they open the gift.
          Don&rsquo;t include anything unlawful, abusive or that infringes
          someone else&rsquo;s rights. We may cancel and refund an order whose
          message breaks this rule.
        </p>
      </Section>

      <Section heading="Collecting a gift">
        <List
          items={[
            `Voucher gifts can be collected at the place shown on the gift, during its opening hours, within ${LEGAL.giftValidityDays} days of the sender's payment. The expiry date is shown on the gift.`,
            "Each gift can be collected once. Show the QR code or read out the code at the counter.",
            "Gifts have no cash value and can't be exchanged for money, except as our Refund policy describes.",
            "Airtime, data and electricity gifts are sent to the number or meter entered and can't be redirected after they're sent.",
          ]}
        />
      </Section>

      <Section heading="Vendors">
        <p>
          Gifts are handed over by independent businesses
          (&ldquo;vendors&rdquo;) that have agreed to honour SendEbun gifts. The
          vendor is responsible for what they hand over. If something
          isn&rsquo;t right, tell us and we&rsquo;ll resolve it with the vendor
          under our Refund policy.
        </p>
      </Section>

      <Section heading="Fair use">
        <p>
          Don&rsquo;t use SendEbun for fraud, with a payment method you aren&rsquo;t
          authorised to use, or to harass anyone. We may refuse, cancel or
          refund an order we reasonably believe is fraudulent or abusive, and we
          may report it to the authorities.
        </p>
      </Section>

      <Section heading="Our responsibility to you">
        <p>
          We&rsquo;ll provide the service with reasonable care and skill. If we
          fail to, our liability to you for any order is limited to the amount
          you paid for it, except where the law doesn&rsquo;t allow that limit —
          for example, for death or personal injury caused by our negligence, or
          fraud.
        </p>
        <p>
          We aren&rsquo;t responsible for delays or failures caused by things
          outside our reasonable control, such as a bank, payment or telecoms
          outage. Where that stops us delivering a gift, you&rsquo;ll get a
          refund.
        </p>
      </Section>

      <Section heading="Changes and the law">
        <p>
          We may update these terms. The version that applies to an order is the
          one shown on this page when you paid. These terms are governed by the
          laws of the Federal Republic of Nigeria.
        </p>
        <p>
          Questions or complaints:{" "}
          <a href={`mailto:${LEGAL.email}`} className="underline">
            {LEGAL.email}
          </a>{" "}
          or {LEGAL.phone}.
        </p>
      </Section>
    </LegalPage>
  );
}
