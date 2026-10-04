import { nextShuffleProblem } from "@/lib/services/shuffle";
import { serverError } from "../shared";

/** POST /api/shuffle/next -> { itemId, problemId, statement } or { done: true } when nothing is waiting. */
export async function POST() {
  try {
    const next = await nextShuffleProblem();
    if (!next) return Response.json({ done: true });
    // Pick the fields so nothing else (the stored answer, the worked solution) can ever reach the student.
    return Response.json({ itemId: next.itemId, problemId: next.problemId, statement: next.statement });
  } catch (e) {
    return serverError("api/shuffle/next", e);
  }
}
