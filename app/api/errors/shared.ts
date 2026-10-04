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

export function serverError(err: unknown): Response {
  const message = err instanceof Error && err.message ? err.message : "Something went wrong";
  console.error("[errors api]", message);
  return Response.json({ error: message }, { status: 500 });
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
