import { z } from "zod";
import { rejectLine } from "@/lib/services/methodLines";

/** POST /api/method-lines/[id]/reject -> { ok: true } */
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
    console.error("POST /api/method-lines/[id]/reject failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
