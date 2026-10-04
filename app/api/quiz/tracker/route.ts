import { quizTracker } from "@/lib/services/quiz";

/** GET /api/quiz/tracker -> { byUnit: [{ unitNumber, total, passed }] } */
export async function GET(_req?: Request) {
  try {
    return Response.json(await quizTracker());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("GET /api/quiz/tracker failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
