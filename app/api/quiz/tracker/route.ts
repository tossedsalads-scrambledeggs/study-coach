import { quizTracker } from "@/lib/services/quiz";

/** GET /api/quiz/tracker -> { byUnit: [{ unitNumber, total, passed }] } */
export async function GET(_req?: Request) {
  try {
    return Response.json(await quizTracker());
  } catch (error) {
    console.error("GET /api/quiz/tracker failed:", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
