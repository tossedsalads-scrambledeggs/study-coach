/**
 * What the mail routes tell a caller when something fails.
 *
 * The app is public and has no login, so a 500 never carries raw exception text (SQL, hosts, gateway bodies, the
 * student's address): the reason is logged server-side and the caller gets a fixed sentence. Only deliberate
 * user-facing messages pass through.
 */

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const THROTTLED_ERROR = "Please wait a minute before sending again.";

/** Messages thrown on purpose for the user to read, matched exactly. */
const DELIBERATE_MESSAGES = new Set(["No course yet"]);

/** True for the error sendDue() rejects with when its send guard holds a send back (the route answers 429). */
export function isThrottled(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { throttled?: unknown }).throttled === true;
}

/** The message a 500 response carries: a deliberate user-facing message, else the generic sentence. */
export function publicError(error: unknown): string {
  return error instanceof Error && DELIBERATE_MESSAGES.has(error.message) ? error.message : GENERIC_ERROR;
}

/** The reason for a server-side log line: one short line, no email address, no API key. */
export function logReason(error: unknown): string {
  let text = error instanceof Error && error.message ? error.message : "unknown error";
  for (const secret of [process.env.STUDENT_EMAIL, process.env.AGENT_MAIL_KEY]) {
    if (secret) text = text.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  }
  return text
    .replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, "[email]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}
