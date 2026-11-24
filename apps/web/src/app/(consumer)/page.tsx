import { redirect } from "next/navigation";

/**
 * The front door is /send's "Where are they?" screen.
 *
 * "/" used to ask "Who's it for?" first, but nearly everyone answered
 * "Someone", and its other two answers (an event, a team) already sit
 * on the city screen under "More ways". Two questions before any gift
 * became one. Its "Continue" list moved there too. A redirect rather
 * than rendering /send here keeps one address for the screen, so
 * analytics, links and the back button all agree.
 */
export default function Home() {
  redirect("/send");
}
