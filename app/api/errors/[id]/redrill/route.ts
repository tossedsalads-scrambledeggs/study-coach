import { z } from "zod";
import { answerRedrill } from "@/lib/services/errors";
import { badRequest, parseBody, serverError } from "../../shared";

const redrillSchema = z.object({
  answer: z.string().trim().min(1, "answer is required").max(10000),
});

/** POST /api/errors/[id]/redrill { answer } -> Grade. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !id.trim()) return badRequest("id is required");
  const parsed = await parseBody(req, redrillSchema);
  if ("response" in parsed) return parsed.response;
  try {
    return Response.json(await answerRedrill(id, parsed.data.answer));
  } catch (err) {
    return serverError(err);
  }
}
