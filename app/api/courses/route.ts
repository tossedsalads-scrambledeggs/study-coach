import { z } from "zod";
import { createCourse } from "@/lib/services/courses";

// Planning reads a website, then makes two model calls: allow a few minutes.
export const maxDuration = 300;

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Log the real failure here; the student only sees a deliberate message (marked userFacing) or a generic one. */
function failure(err: unknown): Response {
  console.error("[POST /api/courses] failed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  const deliberate = err instanceof Error && (err as { userFacing?: unknown }).userFacing === true;
  return Response.json({ error: deliberate ? (err as Error).message : GENERIC_ERROR }, { status: 500 });
}

// Empty, whitespace-only and null fields all mean "not given": the form may send "" for the field the
// student did not use. courseUrl is a course website OR a course name (Exa searches for a name), so it is
// not required to be a URL; only a web address with a scheme other than http(s) is refused.
const bodySchema = z
  .object({
    title: z.string().max(200).nullish(),
    syllabusText: z.string().max(300_000).nullish(),
    courseUrl: z.string().max(2_000).nullish(),
  })
  .superRefine((body, ctx) => {
    const course = body.courseUrl?.trim();
    if (!body.syllabusText?.trim() && !course) {
      ctx.addIssue({
        code: "custom",
        path: ["syllabusText"],
        message: "Give a course website or name, or paste a syllabus.",
      });
    }
    if (course && /^[a-z][a-z0-9+.-]*:\/\//i.test(course) && !/^https?:\/\//i.test(course)) {
      ctx.addIssue({
        code: "custom",
        path: ["courseUrl"],
        message: "A course website must start with http:// or https://. You can also enter the course name.",
      });
    }
  });

/** POST /api/courses  {title?, syllabusText?, courseUrl?} -> {courseId}. courseUrl may be a URL or a course name. */
export async function POST(req: Request) {
  // Demo lock: the deployed demo keeps the student's own course; nothing can replace it.
  if (process.env.DEMO_LOCK === "1") {
    return Response.json({ error: "This demo is locked to the student's course." }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "The request body must be JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const { title, syllabusText, courseUrl } = parsed.data;
    const result = await createCourse({
      title: title?.trim() || undefined,
      syllabusText: syllabusText?.trim() || undefined,
      courseUrl: courseUrl?.trim() || undefined,
    });
    return Response.json(result);
  } catch (err) {
    return failure(err);
  }
}
