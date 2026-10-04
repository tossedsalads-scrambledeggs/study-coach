import { z } from "zod";
import { approveLine } from "@/lib/services/methodLines";

/** POST /api/method-lines/[id]/approve -> { line }; 404 for an unknown id, 409 when already decided or a duplicate. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) {
    return Response.json({ error: "Invalid method line id" }, { status: 400 });
  }

  try {
    return Response.json({ line: await approveLine(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Deliberate user-facing messages from the service pass through; anything else is logged, not returned.
    if (message === "Method line not found") return Response.json({ error: message }, { status: 404 });
    if (message === "Method line is not pending" || message.startsWith("Duplicate of:")) {
      return Response.json({ error: message }, { status: 409 });
    }
    console.error("POST /api/method-lines/[id]/approve failed:", message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
