import { expect } from "vitest";

/**
 * Shared fixtures and request helpers for the T4 (Shuffle pile) route tests.
 * Written from docs/PLAN.md and the T4 issue only.
 */

/** Well-formed v4 UUIDs, so fixtures pass whether a route validates ids with min(1) or uuid(). */
export const ITEM_ID = "3f2b8c1e-5d4a-4e7b-9a6c-1d2e3f4a5b6c";
export const PROBLEM_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
export const ERROR_LOG_ID = "c9bf9e57-1685-4c89-bafb-ff5af830be8a";

/**
 * Route handlers are called with a plain Request. Casting to this type also covers a handler that is
 * declared without parameters (as a no-body route may be).
 */
export type RouteHandler = (req: Request) => Response | Promise<Response>;

const JSON_HEADERS = { "content-type": "application/json" };

/** POST with a JSON body. */
export function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://test${path}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** POST whose body is sent exactly as given (used for malformed JSON). */
export function rawPost(path: string, rawBody: string): Request {
  return new Request(`http://test${path}`, { method: "POST", headers: JSON_HEADERS, body: rawBody });
}

/** POST with no body at all. */
export function emptyPost(path: string): Request {
  return new Request(`http://test${path}`, { method: "POST" });
}

export interface Parsed {
  status: number;
  text: string;
  body: Record<string, unknown>;
}

/** Read a response once; `text` is kept so failed assertions can show what the route actually sent. */
export async function parse(res: Response): Promise<Parsed> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch {
    // Not JSON: leave body empty. The assertions print the raw text.
  }
  return { status: res.status, text, body };
}

/** The shared error contract: HTTP 400 or 500 with a JSON body {error: "<non-empty message>"}. */
export function expectErrorResponse(r: Parsed, status: 400 | 500): void {
  expect(r.status, `expected HTTP ${status} but got ${r.status}. Body: ${r.text}`).toBe(status);
  expect(typeof r.body.error, `expected a JSON body {"error": "<message>"}. Body: ${r.text}`).toBe("string");
  expect((r.body.error as string).length, `error message must not be empty. Body: ${r.text}`).toBeGreaterThan(0);
}
