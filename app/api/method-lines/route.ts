import { listMethodLines } from "@/lib/services/methodLines";

/** GET /api/method-lines -> { lines }: every line on the current course's sheet except rejected ones. */
export async function GET(_req?: Request) {
  try {
    return Response.json({ lines: await listMethodLines() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("GET /api/method-lines failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
