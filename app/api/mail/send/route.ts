import { THROTTLED_ERROR, isThrottled, logReason, publicError } from "@/app/api/mail/safe-error";
import { sendDue } from "@/lib/agents/mailCoach";

export const maxDuration = 60;

/**
 * POST /api/mail/send: email the student what is due. -> { sent: number }
 * 429 when a send went out in the last minute (the URL is public, so it cannot be used to spam the student).
 */
export async function POST() {
  try {
    return Response.json({ sent: await sendDue() });
  } catch (error) {
    if (isThrottled(error)) {
      return Response.json({ error: THROTTLED_ERROR }, { status: 429, headers: { "Retry-After": "60" } });
    }
    console.error(`mail send: ${logReason(error)}`);
    return Response.json({ error: publicError(error) }, { status: 500 });
  }
}
