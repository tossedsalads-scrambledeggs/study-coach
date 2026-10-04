# Study Coach: build plan and shared spec

Every agent reads this file first. The orchestrator owns it; propose changes as a `question` issue.
Hard deadline: **submissions close 4:30 PM PT, Oct 4 2026. Code freeze 4:00 PM.**

## 1. What Study Coach does

A study coach website for one course at a time. Single demo student, no login (every table hangs off
`students`, so login is one step later).

1. **Study plan.** Reads a syllabus (pasted text, PDF text, or the course website via Exa) and lays the
   course out week by week from first class to last: units, lectures, deadlines, estimated study hours
   per unit, difficulty 1-5 with a one-line reason.
2. **Method sheet.** Rows of Unit, Lecture, Trigger, Move, Trap, Source. Seeded from the course
   material; grows from the error log.
   **RULE: a line must be actionable inside a problem, not true-in-general.**
   "Var(X) = E[X^2] - (E[X])^2" is NOT a line. "When asked for the variance of a SUM, check independence
   FIRST, otherwise the covariance term is live" IS a line. Lines are generic to the situation, never
   about one specific problem.
3. **Method quiz.** Always random among eligible lines: approved (`active`), not yet passed, and
   `unit_number <= current unit`. Each question is a fresh scenario (never repeat an earlier wording)
   that fires the trigger; the student answers with the move. One pass retires the line
   (`passed_at`). A failed line stays in the random pool. Tracker shows passed / total per unit.
4. **Error log.** The student gives a problem they got wrong and their approach. The agent finds where
   they went wrong and fills: date, week/unit, lecture, problem, what went wrong, correct approach,
   error type(s), fix/lesson, re-drill date, cleared?, cleared on.
   - Error types: `concept_gap`, `computational_slip`, `wrong_tool`, `misread_setup`. Can be several;
     the agent picks one primary.
   - Any type other than a pure computational slip also drafts a method line. It is saved as
     `status = 'pending'` and the student approves or rejects it (approval card).
   - Re-drill date: problem from the unit the student is on -> today + 2 days; from any earlier unit ->
     today + 7 days (`lib/rules.ts`).
   - On the re-drill date the student re-solves it; pass -> `cleared`, `cleared_on`, and it moves to
     the shuffle pile. Fail -> new re-drill date by the same rule.
5. **Shuffle pile.** Holds cleared problems and problems the student logged as "I got this right".
   The agent generates a new, similar problem (same method, new surface). Pass -> fully cleared. Fail ->
   a new error-log row for the variant (diagnosed like any error), re-drill date by the rule.

Current unit = latest unit whose start date has passed, unless the student set a manual override
(`lib/rules.ts: currentUnit`).

## 2. Sponsor tools: each one does real work

| Tool | Job |
| --- | --- |
| Neon Postgres | All state and the agents' shared memory (`db/schema.sql`). pgvector on method lines to block duplicates. |
| Neon AI Gateway | Every model call and embedding, via `lib/llm.ts` only. |
| Exa | Reads the course website (syllabus, schedule, lecture notes) from a URL or course name. |
| AgentMail | Coach's own inbox: emails a due question; the student replies; the reply is graded and answered in-thread. Only `STUDENT_EMAIL` is accepted. |
| Fly.io Sprite | Hosts the app and the mail webhook at a public URL; sleeps until a request or email arrives. |
| assistant-ui | Quiz, error-log and shuffle chats with custom tool cards (question, grade, diagnosis, approval). |
| CodeRabbit | Reviews every PR. |

## 3. Architecture (one Next.js app, TypeScript)

```
lib/contracts.ts   types + agent signatures + service interfaces   (orchestrator)
lib/rules.ts       re-drill, current unit, quiz pool, method-line rule (orchestrator)
lib/llm.ts         Neon AI Gateway: chat(), llmJSON(), embed()     (orchestrator)
lib/db.ts          Neon Postgres: query()                          (orchestrator)
db/schema.sql      tables                                          (orchestrator)
lib/agents/*.ts    pure agent functions: inputs -> model -> typed output (no DB)
lib/services/*.ts  DB + agents; implement the service interfaces in contracts.ts
app/api/**         thin REST routes over services (JSON in/out, 400 on bad input)
app/(app)/**       pages
```

Agents never call each other. Services talk through the database. The chat and the mail coach call
services through the interfaces in `lib/contracts.ts` only.

### REST API

| Route | Body -> Response |
| --- | --- |
| `POST /api/courses` | `{title?, syllabusText?, courseUrl?}` -> `{courseId}` (plans, saves units/weeks, seeds method lines) |
| `GET /api/courses/current` | -> `CourseView` or 404 |
| `PATCH /api/courses/current` | `{currentUnitOverride: number or null}` -> `{ok: true}` |
| `GET /api/method-lines` | -> `{lines: MethodLine[]}` |
| `POST /api/method-lines/[id]/approve` and `/reject` | -> `{line}` / `{ok: true}` |
| `POST /api/quiz/next` | -> `{question: QuizQuestion}` or `{done: true}` |
| `POST /api/quiz/answer` | `{methodLineId, question, answer}` -> `Grade` |
| `GET /api/quiz/tracker` | -> `{byUnit: [{unitNumber, total, passed}]}` |
| `POST /api/errors` | `NewProblemInput & {studentApproach}` -> `{entry, pendingLine}` |
| `GET /api/errors` | -> `{entries: ErrorLogEntry[]}` |
| `GET /api/errors/due` | -> `{entries}` due today or earlier, not cleared |
| `POST /api/errors/[id]/redrill` | `{answer}` -> `Grade` |
| `POST /api/problems/correct` | `NewProblemInput` -> `{problemId}` |
| `POST /api/shuffle/next` | -> `{itemId, problemId, statement}` or `{done: true}` |
| `POST /api/shuffle/answer` | `{itemId, problemId, answer}` -> `Grade & {errorLogId}` |
| `POST /api/mail/send` | -> `{sent: number}` (emails what's due) |
| `POST /api/mail/webhook` | AgentMail `message.received` webhook |
| `POST /api/chat` | assistant-ui coach chat (tools call services) |

## 4. Tasks and file ownership

A builder may create or edit only the paths it owns. Need anything else (a package, a contract
change, a shared component)? Open a `question` issue and keep going on what you own.

| Task | Builder owns | Tools |
| --- | --- | --- |
| T1 Planner | `lib/exa.ts`, `lib/agents/planner.ts`, `lib/agents/methodSheet.ts`, `lib/services/courses.ts`, `app/api/courses/**`, `app/(app)/plan/**` | Exa, Gateway, Neon |
| T2 Error coach | `lib/agents/errorCoach.ts`, `lib/services/errors.ts`, `app/api/errors/**`, `app/api/problems/**`, `app/(app)/errors/**` | Gateway, Neon |
| T3 Method quiz | `lib/agents/methodQuiz.ts`, `lib/services/quiz.ts`, `lib/services/methodLines.ts`, `app/api/quiz/**`, `app/api/method-lines/**`, `app/(app)/methods/**` | Gateway, Neon (pgvector) |
| T4 Shuffle | `lib/agents/shuffle.ts`, `lib/services/shuffle.ts`, `app/api/shuffle/**` | Gateway, Neon |
| T5 Mail coach | `lib/agentmail.ts`, `lib/agents/mailCoach.ts`, `app/api/mail/**` | AgentMail, Neon |
| T6 Coach UI | `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/quiz/**`, `app/(app)/shuffle/**`, `app/api/chat/**`, `components/coach/**`, `components/tool-ui/**`; deletes `app/page.tsx`, `app/assistant.tsx` | assistant-ui |
| Tests | `tests/<task>/**` only (test writer) | |
| Orchestrator | everything else: `lib/contracts.ts`, `lib/rules.ts`, `lib/llm.ts`, `lib/db.ts`, `db/`, `docs/`, `package.json`, configs, `components/ui/**` | |

## 5. Build pipeline (decoupled agents, GitHub is the message board)

```
O opens issue (spec + acceptance criteria + owned paths)        label status:ready
  T (test writer) writes tests/<task>/ from the criteria only     never reads the implementation
  B (builder: Claude supervisor + its own Cursor agent)            own git worktree, never commits
                                                                   label status:built
G (gate) runs `npm run check` in the worktree (typecheck + all tests)
  fail -> failures posted on the issue, back to B                 label status:failed
  pass -> commit, push branch, open PR "Closes #n"                label status:in-review
CodeRabbit reviews the PR
R (CodeRabbit agent) triages each comment: fix -> list on the issue -> B -> G again;
  skip -> reply on the thread with the reason                     label status:ready-to-merge
G re-runs checks, merges to main                                   issue closed
J (judge check, read-only) scores main + live URL against the judges' wishes at ~2:45 and ~3:45
Q (questions) any agent blocked on the student opens an issue labelled `question`; only that task waits
```

No agent calls another. Each reads the board and the repo, and writes only its own outputs.

## 6. Coding rules

- Never print, log, commit or paste secrets. Read env vars by name only. `.env` stays local.
- All model calls: `chat`, `llmJSON`, `embed` from `@/lib/llm`. All SQL: `query` from `@/lib/db`.
  Default to `MODELS.smart` for diagnosis, planning and problem writing; `MODELS.fast` for grading and
  quiz questions.
- Agents (`lib/agents/*`) take plain inputs and return the contract type; they never touch the DB, so
  tests can mock `@/lib/llm`.
- Validate request bodies with `zod`; 400 with `{error}` on bad input; 500 with `{error}` on failure.
- Don't edit `package.json`; packages available: next, react, ai, @ai-sdk/openai-compatible,
  @assistant-ui/react, @assistant-ui/ai-sdk, @assistant-ui/react-markdown, pg, exa-js, agentmail, zod,
  lucide-react, tailwind, vitest.
- `npm run check` must pass before handing off.
- UI: readable and calm. Plain words, generous spacing, real loading/empty/error states, keyboard
  reachable, tabular numbers in tables, `text-wrap: balance` on headings. Use `components/ui/*`.
- Error types for the diagnosis prompt: **concept gap** = misunderstands what an idea means or when it
  applies; **computational slip** = right method, arithmetic or algebra mistake; **wrong tool** = knows
  the concepts but reached for a formula or technique that doesn't fit; **misread setup** = solved a
  different problem than the one asked (missed a condition, misread what X counts).
