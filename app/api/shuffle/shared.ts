/** Error response shared by the shuffle routes. */

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Messages lib/services/shuffle.ts throws on purpose; they are safe to show the student.
 * Keep in step with the service. Every other message is replaced by GENERIC_ERROR.
 */
const USER_FACING = new Set([
  "No course yet",
  "That shuffle problem was not found",
  "That problem does not belong to that shuffle item",
]);

/**
 * 500 for a failed request. The app is public with no login, so raw exception text (SQL, hosts, gateway
 * bodies) never goes out: the error is logged here and the student sees a plain message.
 */
export function serverError(route: string, err: unknown): Response {
  console.error(`[${route}]`, err);
  const message = err instanceof Error && USER_FACING.has(err.message) ? err.message : GENERIC_ERROR;
  return Response.json({ error: message }, { status: 500 });
}
