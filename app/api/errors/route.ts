import { z } from "zod";
import { listErrors, logError } from "@/lib/services/errors";
import { newProblemSchema, parseBody, serverError } from "./shared";

// Reads the database on every request; never prerendered or cached.
export const dynamic = "force-dynamic";

const logErrorSchema = newProblemSchema.extend({
  studentApproach: z.string().trim().min(1, "studentApproach is required").max(10000),
});

/** GET /api/errors -> { entries }: the error log, newest first. */
export async function GET() {
  try {
    return Response.json({ entries: await listErrors() });
  } catch (err) {
    return serverError(err);
  }
}

/** POST /api/errors: diagnose a mistake and log it -> { entry, pendingLine }. */
export async function POST(req: Request) {
  const parsed = await parseBody(req, logErrorSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const { entry, pendingLine } = await logError(parsed.data);
    return Response.json({ entry, pendingLine });
  } catch (err) {
    return serverError(err);
  }
}
