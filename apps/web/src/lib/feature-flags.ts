/**
 * Environment-variable feature flags for the web app, one line each.
 *
 * Server-only and read per request, never NEXT_PUBLIC_: a NEXT_PUBLIC_
 * value is baked into the JavaScript bundle at build time, so flipping
 * it means rebuilding. These are read by server components and passed
 * down as props, so changing one is an environment change, not a code
 * change. (Vercel still applies env changes on the next deployment —
 * a redeploy of the same commit, not a new build of new code.)
 *
 * Imported only by server components. If one is ever imported into a
 * client component by mistake it fails safe: a non-NEXT_PUBLIC_ variable
 * is undefined in the browser, so the flag reads as off.
 */

/**
 * true  → Ebun delivers the reveal link itself over WhatsApp (Termii or
 *         Cloud API configured and a template approved).
 * unset → the sender sends it, from the confirmation screen, with one
 *         tap. Also hides "Send later": with nothing on Ebun's side to
 *         deliver a scheduled gift, offering a date would be a promise
 *         nobody keeps.
 */
export function whatsappAutoDeliveryEnabled(): boolean {
  return process.env.WHATSAPP_AUTO_DELIVERY === "true";
}

/**
 * true  → senders can record a voice note or video (the API's private R2
 *         bucket, R2_MEDIA_BUCKET, must be set too).
 * unset → the Voice and Video tabs are hidden; writing a message is the
 *         only option. Keep this off until a recording has been sent and
 *         played back once on production.
 */
export function mediaMessagesEnabled(): boolean {
  return process.env.MEDIA_MESSAGES === "true";
}

/**
 * true  → /company/start is open: a company signs itself up, gets its
 *         private link by email and sets up and pays for a campaign
 *         with no one from SendEbun involved. The API needs
 *         CORPORATE_SELF_SERVE=true as well.
 * unset → only ops starts campaigns; /company/start is a 404.
 */
export function corporateSelfServeEnabled(): boolean {
  return process.env.CORPORATE_SELF_SERVE === "true";
}

/**
 * true  → the send flow offers "Chip in with friends", which starts a
 *         group gift instead of paying alone. The API needs
 *         GROUP_GIFTING=true as well.
 * unset → the toggle is hidden. Pots already running keep working: their
 *         pages, the organiser's page and every refund.
 */
export function groupGiftingEnabled(): boolean {
  return process.env.GROUP_GIFTING === "true";
}
