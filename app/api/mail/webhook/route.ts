import { logReason, publicError } from "@/app/api/mail/safe-error";
import { handleInbound } from "@/lib/agents/mailCoach";

export const maxDuration = 60;

/**
 * POST /api/mail/webhook: AgentMail `message.received`.
 * Any valid JSON gets 200, ignored mail included: AgentMail retries every other status, and mail that is
 * not for the coach must not be retried. Only an unexpected failure answers 500 (so AgentMail redelivers).
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // Do not echo the parse error: it can quote the body.
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  try {
    return Response.json({ ok: true, ...(await handleInbound(payload)) });
  } catch (error) {
    console.error(`mail webhook: ${logReason(error)}`);
    return Response.json({ error: publicError(error) }, { status: 500 });
  }
}
