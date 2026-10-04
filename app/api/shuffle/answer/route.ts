import { z } from "zod";
import { answerShuffle } from "@/lib/services/shuffle";
import { serverError } from "../shared";

const bodySchema = z.object({
  // guid: any 8-4-4-4-12 hex id, which is all Postgres' uuid columns need. A malformed id is a 400, not a database error.
  itemId: z.guid(),
  problemId: z.guid(),
  answer: z.string().refine((s) => s.trim().length > 0, "answer must not be empty"),
});

/** POST /api/shuffle/answer { itemId, problemId, answer } -> { passed, feedback, errorLogId } */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return Response.json({ error }, { status: 400 });
  }

  try {
    return Response.json(await answerShuffle(parsed.data));
  } catch (e) {
    return serverError("api/shuffle/answer", e);
  }
}
