import { listMethodLines } from "@/lib/services/methodLines";

/** GET /api/method-lines -> { lines }: every line on the current course's sheet except rejected ones. */
export async function GET(_req?: Request) {
  try {
    return Response.json({ lines: await listMethodLines() });
  } catch (error) {
    console.error("GET /api/method-lines failed:", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
