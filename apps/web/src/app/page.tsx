import { redirect } from "next/navigation";

/**
 * The app's front door is the send flow. Marketing lives on the landing
 * site (ebun.com.ng); a second, smaller landing page here only drifted
 * out of step with it — it was still in the old black-and-gold palette
 * after the rebrand.
 */
export default function Home() {
  redirect("/send");
}
