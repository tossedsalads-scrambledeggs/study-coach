import Exa from "exa-js";

/**
 * Exa reads the course website. fetchCourseText returns the page's text; when the page is thin
 * (a landing page that only links to the real schedule) it also searches the same site for
 * syllabus / schedule pages and appends their text. Total output is capped for the planner prompt.
 */

/** Hard cap on the text handed back to the planner. */
export const MAX_COURSE_TEXT_CHARS = 60_000;
/** Per-page cap asked of Exa. */
const MAX_PAGE_CHARS = 30_000;
/** A page with less text than this is treated as thin: look for syllabus/schedule pages on the site. */
const THIN_PAGE_CHARS = 2_000;
const SEARCH_RESULTS = 5;
const SEARCH_TOPICS = "course syllabus schedule of lectures, assignments, problem sets and exams";

type PageText = { url: string; text: string };

function client(): Exa {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) {
    throw new Error("EXA_API_KEY is not set, so the course website cannot be read. Paste the syllabus text instead.");
  }
  return new Exa(key);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** HTTP status carried by an ExaError (or anything shaped like one). */
function statusCode(err: unknown): number | null {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : null;
}

function isAuthError(err: unknown): boolean {
  const code = statusCode(err);
  return code === 401 || code === 403;
}

/** A short, plain reason for a failed Exa call. */
function explain(err: unknown): string {
  if (isAuthError(err)) return "Exa rejected the API key (EXA_API_KEY)";
  const code = statusCode(err);
  if (code === 402) return "The Exa account is out of credits";
  if (code === 429) return "Exa is rate limiting requests right now, try again in a minute";
  return message(err);
}

/** Trim, add https:// when the scheme is missing, and make sure it is a real http(s) URL. Returns the string Exa gets. */
function normalizeUrl(input: string): { url: string; host: string } {
  const raw = (input ?? "").trim();
  if (!raw) throw new Error("The course URL is empty");
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The course URL must start with http:// or https://");
  }
  return { url, host: parsed.hostname.replace(/^www\./i, "") };
}

function sameUrl(a: string, b: string): boolean {
  const strip = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  return strip(a) === strip(b);
}

function toPages(results: unknown): PageText[] {
  if (!Array.isArray(results)) return [];
  const pages: PageText[] = [];
  for (const r of results) {
    const text = typeof r?.text === "string" ? r.text.trim() : "";
    if (text) pages.push({ url: typeof r?.url === "string" ? r.url : "", text });
  }
  return pages;
}

export async function fetchCourseText(url: string): Promise<string> {
  const { url: pageUrl, host } = normalizeUrl(url);
  const exa = client();

  let mainText = "";
  let title = "";
  let reason = "";
  let rejected = false;
  try {
    const res = await exa.getContents([pageUrl], { text: { maxCharacters: MAX_PAGE_CHARS } });
    mainText = toPages(res?.results)
      .map((p) => p.text)
      .join("\n\n");
    const first = Array.isArray(res?.results) ? res.results[0] : undefined;
    title = typeof first?.title === "string" ? first.title.trim() : "";
    reason = res?.statuses?.find((s) => s?.error)?.error?.tag ?? "";
  } catch (err) {
    // A bad key fails every call, so stop. Anything else: the site search below may still find the schedule.
    rejected = isAuthError(err);
    reason = explain(err);
  }

  const parts: string[] = [];
  if (mainText) parts.push(mainText);

  if (!rejected && mainText.length < THIN_PAGE_CHARS) {
    try {
      // The page title keeps the search on this course when the site hosts many (a university, a MOOC platform).
      const found = await exa.search(`${title ? `${title} ` : ""}${host} ${SEARCH_TOPICS}`, {
        includeDomains: [host],
        numResults: SEARCH_RESULTS,
        contents: { text: { maxCharacters: MAX_PAGE_CHARS } },
      });
      const seen = new Set<string>();
      for (const page of toPages(found?.results)) {
        if (sameUrl(page.url, pageUrl) || seen.has(page.url)) continue;
        seen.add(page.url);
        parts.push(page.url ? `=== ${page.url} ===\n${page.text}` : page.text);
      }
    } catch (err) {
      if (!reason) reason = explain(err);
    }
  }

  const text = parts.join("\n\n").slice(0, MAX_COURSE_TEXT_CHARS).trim();
  if (!text) {
    throw new Error(
      `${reason ? `${reason}. ` : ""}Could not read any text from ${pageUrl}. Paste the syllabus text instead.`,
    );
  }
  return text;
}
