-- Study Coach schema. Owned by the orchestrator; builders read it, never change it.
-- Every table hangs off courses -> students, so multi-user is a login away.

create extension if not exists vector;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Student',
  email text,
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  title text not null,
  source_url text,
  syllabus_text text,
  start_date date,
  end_date date,
  current_unit_override int,
  created_at timestamptz not null default now()
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  number int not null,
  title text not null,
  start_date date,
  end_date date,
  lectures text,
  topics text,
  est_hours numeric(5,1),
  difficulty int check (difficulty between 1 and 5),
  difficulty_reason text,
  unique (course_id, number)
);

create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  week_number int not null,
  start_date date not null,
  unit_number int,
  lectures text,
  topics text,
  deadlines text,
  study_hours numeric(5,1),
  unique (course_id, week_number)
);

create table if not exists method_lines (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  unit_number int not null,
  lecture text,
  trigger text not null,
  move text not null,
  trap text not null,
  source text,
  origin text not null check (origin in ('seed', 'error')),
  status text not null default 'active' check (status in ('active', 'pending', 'rejected')),
  error_log_id uuid,
  embedding vector(1024),
  passed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists problems (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  unit_number int not null,
  lecture text,
  label text not null,
  statement text not null,
  answer text,
  origin text not null check (origin in ('user', 'shuffle')),
  parent_problem_id uuid references problems(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists error_log (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  problem_id uuid not null references problems(id) on delete cascade,
  logged_on date not null default current_date,
  week_number int,
  unit_number int not null,
  lecture text,
  student_approach text not null,
  what_went_wrong text not null,
  correct_approach text not null,
  error_types text[] not null,
  primary_error_type text not null
    check (primary_error_type in ('concept_gap', 'computational_slip', 'wrong_tool', 'misread_setup')),
  lesson text not null,
  redrill_on date not null,
  cleared boolean not null default false,
  cleared_on date,
  method_line_id uuid references method_lines(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists shuffle_pile (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  problem_id uuid not null unique references problems(id) on delete cascade,
  reason text not null check (reason in ('cleared', 'got_right')),
  status text not null default 'waiting' check (status in ('waiting', 'fully_cleared')),
  entered_on date not null default current_date,
  fully_cleared_on date
);

-- Every graded answer: method quiz, re-drill, shuffle variant.
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  kind text not null check (kind in ('quiz', 'redrill', 'shuffle')),
  method_line_id uuid references method_lines(id) on delete cascade,
  error_log_id uuid references error_log(id) on delete cascade,
  problem_id uuid references problems(id) on delete cascade,
  question text not null,
  student_answer text not null,
  passed boolean not null,
  feedback text,
  created_at timestamptz not null default now()
);

-- Email threads the coach started, so a reply can be matched to its question.
create table if not exists mail_threads (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  thread_id text not null unique,
  kind text not null check (kind in ('quiz', 'redrill', 'shuffle')),
  ref_id uuid,
  question text not null,
  created_at timestamptz not null default now()
);

create index if not exists method_lines_course_unit on method_lines (course_id, unit_number);
create index if not exists error_log_course_redrill on error_log (course_id, redrill_on);
create index if not exists attempts_course_kind on attempts (course_id, kind);

-- The single demo student (no login for the demo).
insert into students (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Demo student')
on conflict (id) do nothing;
