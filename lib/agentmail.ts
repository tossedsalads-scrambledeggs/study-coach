import type { AgentMail, AgentMailClient } from "agentmail";

/**
 * AgentMail: the coach's own inbox. The key is read from AGENT_MAIL_KEY when a call is made, never at import,
 * and is never logged or returned.
 */

/** Stable idempotency key: creating the inbox twice returns the same inbox instead of a second one. */
export const COACH_INBOX_CLIENT_ID = "study-coach-inbox";
const COACH_INBOX_USERNAME = "study-coach";
const COACH_DISPLAY_NAME = "Study Coach";

/** The coach's inbox as AgentMail returns it: `inboxId` (used to send and reply) and `email` (its address). */
export type CoachInbox = AgentMail.inboxes.Inbox;

export async function agentMailClient(): Promise<AgentMailClient> {
  const apiKey = process.env.AGENT_MAIL_KEY;
  if (!apiKey) throw new Error("AGENT_MAIL_KEY must be set");
  // Loaded at run time on purpose: the SDK holds an optional `import("@x402/fetch")` that Turbopack cannot resolve,
  // which fails `next build`. Node resolves the package from node_modules.
  const { AgentMailClient } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ "agentmail");
  return new AgentMailClient({ apiKey });
}

let coachInbox: Promise<CoachInbox> | undefined;

async function createCoachInbox(): Promise<CoachInbox> {
  const client = await agentMailClient();
  try {
    return await client.inboxes.create({
      username: COACH_INBOX_USERNAME,
      displayName: COACH_DISPLAY_NAME,
      clientId: COACH_INBOX_CLIENT_ID,
    });
  } catch {
    // The username may already belong to another AgentMail account: let AgentMail pick the address.
    return await client.inboxes.create({ displayName: COACH_DISPLAY_NAME, clientId: COACH_INBOX_CLIENT_ID });
  }
}

/** Get or create the coach inbox. Idempotent through `clientId`; the result is cached in memory. */
export function getCoachInbox(): Promise<CoachInbox> {
  if (!coachInbox) {
    coachInbox = createCoachInbox().catch((error) => {
      coachInbox = undefined; // never cache a failure
      throw error;
    });
  }
  return coachInbox;
}
