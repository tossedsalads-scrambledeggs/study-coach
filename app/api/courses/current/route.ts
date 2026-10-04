import { z } from "zod";
import { getCurrentCourse, setCurrentUnitOverride } from "@/lib/services/courses";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "Something went wrong. Please try again.";

const patchSchema = z.object({
  // A unit number to pin the current unit, or null to go back to "auto" (latest unit that has started).
  currentUnitOverride: z.number().int().min(1).nullable(),
});

/** Whether the deployed demo is locked to the student's course; the plan page reads this header to hide the create form. */
function demoHeaders(): HeadersInit {
  return process.env.DEMO_LOCK === "1" ? { "x-demo-locked": "1" } : {};
}

/** Log the real failure here; the student only sees a deliberate message (marked userFacing) or a generic one. */
function failure(err: unknown): Response {
  console.error("[/api/courses/current] failed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  const deliberate = err instanceof Error && (err as { userFacing?: unknown }).userFacing === true;
  return Response.json({ error: deliberate ? (err as Error).message : GENERIC_ERROR }, { status: 500 });
}

/** GET /api/courses/current -> CourseView, or 404 when there is no course yet */
export async function GET() {
  try {
    const view = await getCurrentCourse();
    if (!view) return Response.json({ error: "No course yet." }, { status: 404, headers: demoHeaders() });
    return Response.json(view, { headers: demoHeaders() });
  } catch (err) {
    return failure(err);
  }
}

/** PATCH /api/courses/current  {currentUnitOverride: number | null} -> {ok: true} */
export async function PATCH(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "The request body must be JSON." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "currentUnitOverride must be a unit number (1 or more) or null." },
      { status: 400 },
    );
  }

  try {
    await setCurrentUnitOverride(parsed.data.currentUnitOverride);
    return Response.json({ ok: true });
  } catch (err) {
    // The service rejects a unit that is not in the course with an error carrying status 400 (detected by
    // property: the service module is not imported for anything but its functions).
    const known = err as { status?: unknown; userFacing?: unknown } | null;
    if (err instanceof Error && known?.status === 400 && known.userFacing === true) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return failure(err);
  }
}
