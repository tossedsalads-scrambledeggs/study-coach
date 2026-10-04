import { z } from "zod";
import { rejectLine } from "@/lib/services/methodLines";

/** POST /api/method-lines/[id]/reject -> { ok: true }; 404 for an unknown id, 409 when already decided. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) {
    return Response.json({ error: "Invalid method line id" }, { status: 400 });
  }

  try {
    await rejectLine(id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Deliberate user-facing messages from the service pass through; anything else is logged, not returned.
    if (message === "Method line not found") return Response.json({ error: message }, { status: 404 });
    if (message === "Method line is not pending") return Response.json({ error: message }, { status: 409 });
    console.error("POST /api/method-lines/[id]/reject failed:", message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
