import { dueRedrills } from "@/lib/services/errors";
import { serverError } from "../shared";

// Reads the database on every request; never prerendered or cached.
export const dynamic = "force-dynamic";

/** GET /api/errors/due -> { entries }: re-drills due today or earlier that are not cleared. */
export async function GET() {
  try {
    return Response.json({ entries: await dueRedrills() });
  } catch (err) {
    return serverError(err);
  }
}
