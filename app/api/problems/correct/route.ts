import { logCorrectProblem } from "@/lib/services/errors";
import { newProblemSchema, parseBody, serverError } from "@/app/api/errors/shared";

/** POST /api/problems/correct: a problem the student got right goes to the shuffle pile -> { problemId }. */
export async function POST(req: Request) {
  const parsed = await parseBody(req, newProblemSchema);
  if ("response" in parsed) return parsed.response;
  try {
    return Response.json(await logCorrectProblem(parsed.data));
  } catch (err) {
    return serverError(err);
  }
}
