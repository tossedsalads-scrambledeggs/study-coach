import Exa from "exa-js";

/**
 * Exa reads the course material. fetchCourseText takes a course website URL or a course NAME.
 *  - URL: the page's text; when the page is thin (a landing page that only links to the real schedule)
 *    it also searches the same site for syllabus / schedule pages and appends their text.
 *  - Name: an Exa search for "<name> syllabus schedule"; the text of the top results is joined.
 * Every page in the result starts with a "=== <url> ===" line, so the first one is the primary source.
 * Total output is capped for the planner prompt.
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

/** An error whose message is written for the student; routes may show it as is. Any other error becomes a generic message. */
function userError(message: string): Error {
  return Object.assign(new Error(message), { userFacing: true });
}

function client(): Exa {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) {
    throw userError("EXA_API_KEY is not set, so the course website cannot be read. Paste the syllabus text instead.");
  }
  return new Exa(key);
}

/** The raw failure stays in the server log; only a short, plain reason goes into the error the student sees. */
function logFailure(err: unknown): void {
  console.error("[exa] request failed:", err instanceof Error ? (err.stack ?? err.message) : String(err));
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
  const code = statusCode(err);
  if (isAuthError(err)) return "Exa rejected the API key (EXA_API_KEY)";
  if (code === 402) return "The Exa account is out of credits";
  if (code === 429) return "Exa is rate limiting requests right now, so try again in a minute";
  return "Exa could not read the page";
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** True for "https://site/page" and "site.edu/page"; false for a course name such as "MIT 6.431x Probability". */
function looksLikeUrl(input: string): boolean {
  return SCHEME.test(input) || /^[^\s/?#]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(input);
}

/** Add https:// when the scheme is missing and make sure it is a real http(s) URL. Returns the string Exa gets. */
function normalizeUrl(raw: string): { url: string; host: string } {
  const url = SCHEME.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw userError(`"${raw}" is not a valid web address`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw userError("The course website must start with http:// or https://");
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

const section = (url: string, text: string) => (url ? `=== ${url} ===\n${text}` : text);

function joinCapped(parts: string[]): string {
  return parts.join("\n\n").slice(0, MAX_COURSE_TEXT_CHARS).trim();
}

/** A course website: its page, plus same-site syllabus / schedule pages when the page is thin. */
async function readSite(exa: Exa, site: { url: string; host: string }): Promise<string> {
  const { url: pageUrl, host } = site;

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
    const tag = res?.statuses?.find((s) => s?.error)?.error?.tag;
    if (typeof tag === "string" && /^[A-Z_]{3,40}$/.test(tag)) reason = `Exa could not load the page (${tag})`;
  } catch (err) {
    // A bad key fails every call, so stop. Anything else: the site search below may still find the schedule.
    logFailure(err);
    rejected = isAuthError(err);
    reason = explain(err);
  }

  const parts: string[] = [];
  if (mainText) parts.push(section(pageUrl, mainText));

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
        parts.push(section(page.url, page.text));
      }
    } catch (err) {
      logFailure(err);
      if (!reason) reason = explain(err);
    }
  }

  const text = joinCapped(parts);
  if (!text) {
    throw userError(
      `${reason ? `${reason}. ` : ""}Could not read any text from ${pageUrl}. Paste the syllabus text instead.`,
    );
  }
  return text;
}

/** A course name: search the web for its syllabus and schedule and join the top pages. */
async function readByName(exa: Exa, name: string): Promise<string> {
  let reason = "";
  const parts: string[] = [];
  try {
    const found = await exa.search(`${name} syllabus schedule`, {
      numResults: SEARCH_RESULTS,
      contents: { text: { maxCharacters: MAX_PAGE_CHARS } },
    });
    const seen = new Set<string>();
    for (const page of toPages(found?.results)) {
      if (seen.has(page.url)) continue;
      seen.add(page.url);
      parts.push(section(page.url, page.text));
    }
  } catch (err) {
    logFailure(err);
    reason = explain(err);
  }

  const text = joinCapped(parts);
  if (!text) {
    throw userError(
      `${reason ? `${reason}. ` : ""}Could not find a syllabus for "${name}". Try the course website link, or paste the syllabus text instead.`,
    );
  }
  return text;
}

export async function fetchCourseText(input: string): Promise<string> {
  const raw = (input ?? "").trim();
  if (!raw) throw userError("Enter a course website or a course name.");
  if (!looksLikeUrl(raw)) return readByName(client(), raw);
  const site = normalizeUrl(raw);
  return readSite(client(), site);
}
