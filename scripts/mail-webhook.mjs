// Register the AgentMail webhook that delivers the student's email replies to this app.
//
//   node scripts/mail-webhook.mjs https://<public-base-url>
//
// Idempotent: run it again after a redeploy or a URL change. Prints only the webhook id and URL.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { AgentMailClient } from "agentmail";

if (existsSync(".env")) process.loadEnvFile(".env");

const INBOX_CLIENT_ID = "study-coach-inbox"; // same inbox as lib/agentmail.ts
const INBOX_USERNAME = "study-coach";
const WEBHOOK_CLIENT_ID = "study-coach-webhook";
const EVENT = "message.received";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const base = (process.argv[2] ?? "").trim().replace(/\/+$/, "");
let parsed;
try {
  parsed = new URL(base);
} catch {
  // handled below
}
if (!parsed || !/^https?:$/.test(parsed.protocol)) {
  fail("Usage: node scripts/mail-webhook.mjs https://<public-base-url>");
}
const hookUrl = `${base}/api/mail/webhook`;

const apiKey = process.env.AGENT_MAIL_KEY;
if (!apiKey) fail("AGENT_MAIL_KEY must be set (in the environment or in .env)");
const client = new AgentMailClient({ apiKey });

/** Get or create the coach inbox (same idempotent call as getCoachInbox in lib/agentmail.ts). */
async function coachInbox() {
  try {
    return await client.inboxes.create({
      username: INBOX_USERNAME,
      displayName: "Study Coach",
      clientId: INBOX_CLIENT_ID,
    });
  } catch {
    return await client.inboxes.create({ displayName: "Study Coach", clientId: INBOX_CLIENT_ID });
  }
}

/** Is this webhook already delivering message.received for the coach inbox to our URL? */
function registered(webhook, inboxId) {
  const inboxes = webhook.inboxIds ?? [];
  return (
    webhook.url === hookUrl &&
    (webhook.eventTypes ?? [EVENT]).includes(EVENT) &&
    (inboxes.length === 0 || inboxes.includes(inboxId))
  );
}

try {
  const inbox = await coachInbox();
  const create = (clientId) =>
    client.webhooks.create({ url: hookUrl, eventTypes: [EVENT], inboxIds: [inbox.inboxId], clientId });

  // Already registered for this URL (for example this script ran before)?
  const { webhooks } = await client.webhooks.list({ limit: 100 });
  let hook = webhooks.find((w) => registered(w, inbox.inboxId));

  if (!hook) {
    hook = await create(WEBHOOK_CLIENT_ID);
    if (!registered(hook, inbox.inboxId)) {
      // The client id already belongs to a webhook for an earlier URL, and a URL cannot be edited:
      // replace it with one whose client id is derived from the new URL.
      await client.webhooks.delete(hook.webhookId);
      const suffix = createHash("sha1").update(hookUrl).digest("hex").slice(0, 8);
      hook = await create(`${WEBHOOK_CLIENT_ID}-${suffix}`);
    }
  }
  // AgentMail disables a webhook after repeated failed deliveries (for example while the app slept).
  if (hook.enabled === false) hook = await client.webhooks.update(hook.webhookId, { enabled: true });

  console.log(`webhook ${hook.webhookId}`);
  console.log(`url ${hook.url}`);
} catch (error) {
  fail(`Could not register the webhook: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
}
