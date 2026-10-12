import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";
import { LegalPage, List, Section } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy notice",
  description:
    "What SendEbun collects about senders and recipients, why, and your rights.",
};

/**
 * Written to the Nigeria Data Protection Act 2023's notice requirements:
 * who the controller is, what is collected, why and on what lawful
 * basis, who receives it, transfers abroad, retention, and the data
 * subject's rights including the right to complain to the NDPC.
 *
 * Recipients are covered explicitly. They never agreed to anything —
 * the sender handed us their name and number — which is exactly why
 * they are the people this notice most needs to address.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      summary="We collect only what it takes to deliver a gift and keep the money safe. We don't sell personal data, we don't use it for advertising, and we don't share it beyond the services needed to run SendEbun."
    >
      <Section heading="Who is responsible for your data">
        <p>
          {LEGAL.entity}, operating {LEGAL.brand}, is the data controller.
          Contact us about anything in this notice at{" "}
          <a href={`mailto:${LEGAL.email}`} className="underline">
            {LEGAL.email}
          </a>
          , {LEGAL.phone}, or {LEGAL.address}.
        </p>
      </Section>

      <Section heading="If you send a gift">
        <p>We collect:</p>
        <List
          items={[
            "your name and email address, for your receipt and if we need to reach you about the order;",
            "the order itself — the gift, the price, and the Paystack payment reference;",
            "the IP address your order came from, to detect fraud.",
          ]}
        />
        <p>
          Paystack processes your payment. Your card or bank details go to
          Paystack, not to us. We use your details to fulfil the order you asked
          for (a contract with you), and to prevent fraud and keep accounting
          records (our legal obligations and legitimate interests).
        </p>
      </Section>

      <Section heading="If you receive a gift">
        <p>
          Someone who wanted to send you a gift gave us your name and WhatsApp
          number, and their message to you. We use them only to deliver that
          gift: to address it to you, to show it to you when you open it, and to
          let a vendor hand it over. Our lawful basis is legitimate interests —
          delivering a gift meant for you — and we don&rsquo;t use your details
          for anything else.
        </p>
        <p>
          We don&rsquo;t send you marketing because you received a gift. If
          you&rsquo;d rather we didn&rsquo;t hold your details, tell us and
          we&rsquo;ll delete them once any gift waiting for you is collected,
          expired or refunded.
        </p>
      </Section>

      <Section heading="Vendors at the counter">
        <p>
          When a gift is collected, the vendor sees the gift and the
          recipient&rsquo;s name so they can hand over the right thing. Counter
          staff may add their own name when confirming, so a disputed collection
          can be traced.
        </p>
      </Section>

      <Section heading="Who else receives data">
        <p>We use these services to run SendEbun, each only for its purpose:</p>
        <List
          items={[
            "Paystack — payments and refunds.",
            "Supabase — our database.",
            "Vercel and Railway — hosting for our website and servers.",
            "WhatsApp (Meta) — when a gift link is sent through WhatsApp, including when you send it from your own WhatsApp.",
            "The vendor handing over a gift, as described above.",
          ]}
        />
        <p>
          Some of these providers store data outside Nigeria. Where they do, we
          rely on their contractual and security commitments to protect it to
          the standard Nigerian law requires. We may also disclose data where
          the law requires it.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          We keep order and payment records for as long as tax and accounting
          law requires. Gift messages and recipient details are kept with the
          order. You can ask us to delete them sooner, and we will, unless we
          need them to resolve a dispute or meet a legal obligation.
        </p>
      </Section>

      <Section heading="Keeping it safe">
        <p>
          Data travels encrypted between your device and our servers. Access to
          order data is limited to the people and systems that need it, and gift
          links and collection codes are random and single-purpose.
        </p>
      </Section>

      <Section heading="Your rights">
        <p>Under the Nigeria Data Protection Act 2023, you can ask us to:</p>
        <List
          items={[
            "tell you what personal data we hold about you and give you a copy;",
            "correct anything that's wrong;",
            "delete your data, or stop or restrict how we use it;",
            "move your data to another service, where that applies.",
          ]}
        />
        <p>
          Email{" "}
          <a href={`mailto:${LEGAL.email}`} className="underline">
            {LEGAL.email}
          </a>{" "}
          and we&rsquo;ll respond within 30 days. If you&rsquo;re unhappy with
          how we&rsquo;ve handled your data, you can complain to the Nigeria
          Data Protection Commission (NDPC).
        </p>
      </Section>

      <Section heading="Cookies">
        <p>
          We use only the cookies needed to make the service work, such as
          keeping a vendor&rsquo;s counter screen signed in. We don&rsquo;t use
          advertising or tracking cookies.
        </p>
      </Section>

      <Section heading="Age">
        <p>
          SendEbun is for people aged 18 and over to buy gifts. We don&rsquo;t
          knowingly collect data from children who buy gifts.
        </p>
      </Section>
    </LegalPage>
  );
}
