import { z } from "zod";
import { getCurrentCourse, setCurrentUnitOverride } from "@/lib/services/courses";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  // A unit number to pin the current unit, or null to go back to "auto" (latest unit that has started).
  currentUnitOverride: z.number().int().min(1).nullable(),
});

function failure(err: unknown) {
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

/** GET /api/courses/current -> CourseView, or 404 when there is no course yet */
export async function GET() {
  try {
    const view = await getCurrentCourse();
    if (!view) return Response.json({ error: "No course yet." }, { status: 404 });
    return Response.json(view);
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
    return failure(err);
  }
}
