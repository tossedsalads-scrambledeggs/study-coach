import { z } from "zod";
import { createCourse } from "@/lib/services/courses";

// Planning reads a website, then makes two model calls: allow a few minutes.
export const maxDuration = 300;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Empty, whitespace-only and null fields all mean "not given": the form may send "" for the field the
// student did not use. Only a non-empty courseUrl is checked as a URL.
const bodySchema = z
  .object({
    title: z.string().max(200).nullish(),
    syllabusText: z.string().max(300_000).nullish(),
    courseUrl: z.string().max(2_000).nullish(),
  })
  .superRefine((body, ctx) => {
    const url = body.courseUrl?.trim();
    if (!body.syllabusText?.trim() && !url) {
      ctx.addIssue({ code: "custom", path: ["syllabusText"], message: "Give a course website or paste a syllabus." });
    }
    if (url && !isHttpUrl(url)) {
      ctx.addIssue({ code: "custom", path: ["courseUrl"], message: "The course website must be a full http(s) address." });
    }
  });

/** POST /api/courses  {title?, syllabusText?, courseUrl?} -> {courseId} */
export async function POST(req: Request) {
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
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
