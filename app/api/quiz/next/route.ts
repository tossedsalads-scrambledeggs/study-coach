import { nextQuizQuestion } from "@/lib/services/quiz";

/** POST /api/quiz/next -> { question } or { done: true } when no approved, unpassed line is in reach. */
export async function POST(_req?: Request) {
  try {
    const question = await nextQuizQuestion();
    return Response.json(question ? { question } : { done: true });
  } catch (error) {
    console.error("POST /api/quiz/next failed:", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
