/**
 * Link-preview fetchers: the services that request a URL the moment it
 * is pasted into a chat, to draw the little title-and-image card.
 *
 * Why this exists: GET /reveal/:token moves a gift to reveal_opened the
 * first time it is viewed. Once senders paste reveal links into
 * WhatsApp themselves, the SENDER's own WhatsApp fetches the page to
 * build a preview before the message is even sent — so without this,
 * every gift would be marked "opened" by the person who bought it. The
 * reveal page checks this first and serves preview fetchers a static
 * card without ever asking the API about the token.
 *
 * Deliberately a mitigation, not the fix. User agents are a convention,
 * not a guarantee. The structural fix is for viewing to stop being the
 * thing that opens a gift: make GET side-effect free and have the
 * reveal screen POST an explicit "opened" once it is actually on a
 * person's screen (crawlers don't run JavaScript). That is an API change
 * with its own tests; this keeps today's data honest in the meantime.
 *
 * Matches substrings, case-insensitively. WhatsApp's fetcher identifies
 * as "WhatsApp/2.x"; Meta's as facebookexternalhit/facebookcatalog.
 */
const PREVIEW_AGENTS = [
  "whatsapp",
  "facebookexternalhit",
  "facebookcatalog",
  "meta-externalagent",
  "twitterbot",
  "telegrambot",
  "slackbot",
  "slack-imgproxy",
  "discordbot",
  "linkedinbot",
  "skypeuripreview",
  "applebot",
  "googlebot",
  "bingbot",
  "embedly",
  "pinterest",
  "redditbot",
  "snapchat",
  "viber",
  "line/",
];

export function isLinkPreviewFetcher(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return PREVIEW_AGENTS.some((agent) => ua.includes(agent));
}
