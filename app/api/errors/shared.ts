import { z } from "zod";

/** Request validation and error responses shared by the error log and problem routes. */

/** `NewProblemInput`: the problem a student logs. */
export const newProblemSchema = z.object({
  label: z.string().trim().min(1, "label is required").max(300),
  statement: z.string().trim().min(1, "statement is required").max(10000),
  unitNumber: z.number().int().positive(),
  lecture: z.string().trim().max(200).nullish(),
  answer: z.string().trim().max(4000).nullish(),
});

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Deliberate, user-facing service messages. Anything else may carry SQL, hosts or gateway bodies. */
const USER_FACING_ERRORS = new Set(["No course yet", "Error log entry not found"]);

/** Log the real failure server-side; tell the browser only the generic line (or an allowlisted message). */
export function serverError(err: unknown): Response {
  const detail = err instanceof Error && err.message ? err.message : "Unknown error";
  console.error("[errors api]", detail);
  return Response.json({ error: USER_FACING_ERRORS.has(detail) ? detail : GENERIC_ERROR }, { status: 500 });
}

/** Read the JSON body and validate it: the data, or a ready-made 400 response. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: badRequest("Request body must be valid JSON") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
    return { response: badRequest(message || "Invalid request") };
  }
  return { data: parsed.data };
}
