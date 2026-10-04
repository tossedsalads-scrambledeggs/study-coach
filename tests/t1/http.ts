import { expect } from "vitest";

/** Small helpers for calling Next route handlers directly with a plain Request. */

export type Handler = (req: Request) => Response | Promise<Response>;

/** Cast through unknown so these tests stay valid however a handler types its argument (Request or NextRequest). */
export function asHandler(fn: unknown): Handler {
  return fn as Handler;
}

export function jsonRequest(method: string, url: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

/** The shape every failing route must use: the status, and a non-empty `{ error }` string. */
export async function expectError(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const json = (await res.json()) as { error?: unknown };
  expect(typeof json.error).toBe("string");
  expect((json.error as string).length).toBeGreaterThan(0);
}
