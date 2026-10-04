import { z } from "zod";
import { answerQuiz } from "@/lib/services/quiz";

const bodySchema = z.object({
  methodLineId: z.guid(),
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

/** POST /api/quiz/answer { methodLineId, question, answer } -> Grade */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    return Response.json({ error: `Invalid request: ${problems.join("; ")}` }, { status: 400 });
  }

  try {
    return Response.json(await answerQuiz(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/quiz/answer failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
