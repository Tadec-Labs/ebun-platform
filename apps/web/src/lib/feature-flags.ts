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
