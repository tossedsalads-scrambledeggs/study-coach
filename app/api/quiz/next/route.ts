import { nextQuizQuestion } from "@/lib/services/quiz";

/** POST /api/quiz/next -> { question } or { done: true } when no approved, unpassed line is in reach. */
export async function POST(_req?: Request) {
  try {
    const question = await nextQuizQuestion();
    return Response.json(question ? { question } : { done: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("POST /api/quiz/next failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
