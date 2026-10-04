import { expect } from "vitest";
import type { MethodLine } from "@/lib/contracts";

/** Real v4-shaped UUIDs so the fixtures also pass a strict zod `.uuid()` check if a route uses one. */
export const LINE_ID = "3f2b8c4e-5d1a-4b7e-9c3a-2e6f1d8a7b90";
export const OTHER_LINE_ID = "9a7d6c5b-4e3f-4a2b-8c1d-0f9e8d7c6b5a";
export const COURSE_ID = "c0a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";

/** A well-formed, active, unpassed method line. Override only what a test cares about. */
export function makeLine(overrides: Partial<MethodLine> = {}): MethodLine {
  return {
    id: LINE_ID,
    courseId: COURSE_ID,
    unitNumber: 1,
    lecture: "Lec 2",
    trigger: "A question asks for the variance of a sum of random variables",
    move: "Check whether the variables are independent before adding variances",
    trap: "Adding the variances without checking for a covariance term",
    source: "U1 Lec 2",
    origin: "seed",
    status: "active",
    errorLogId: null,
    passedAt: null,
    ...overrides,
  };
}

/** Any Next.js-style route handler: (request, context?) -> Response. */
export type Handler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

/**
 * Route handlers are declared with different parameter lists (GET() vs GET(req), POST(req, ctx)).
 * Casting through `unknown` keeps these tests type-valid whichever signature the route uses.
 */
export function asHandler(fn: unknown): Handler {
  return fn as Handler;
}

/** Context for a dynamic route: Next passes `params` as a promise. */
export function idContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

export function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A request with no body at all (what `fetch(url, { method: "POST" })` sends). */
export function bareRequest(url: string, method = "POST"): Request {
  return new Request(url, { method });
}

/** A request whose body is not valid JSON. */
export function malformedRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ this is not json",
  });
}

/** Parse a JSON response and check it really declares JSON. */
export async function readJson(res: Response): Promise<any> {
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  return res.json();
}
