-- =============================================================================
-- Campus Portal — reference database schema
-- PostgreSQL 16 + pgvector. The source of truth in the codebase will be the
-- Alembic migrations in api/alembic/, generated to match this file.
-- Design notes: docs/09-database-design.md
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector for the assistant
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search (names, library titles)

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Enumerations (stable sets only; editable lists are lookup tables)
-- -----------------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('applicant','student','lecturer','admissions','registry','librarian','admin');
CREATE TYPE gender             AS ENUM ('female','male','other','undisclosed');
CREATE TYPE application_status AS ENUM ('draft','submitted','in_review','more_info','accepted','rejected','withdrawn');
CREATE TYPE eligibility_result AS ENUM ('eligible','not_eligible','needs_review');
CREATE TYPE document_kind      AS ENUM ('national_id','zimsec_o_slip','zimsec_o_cert','zimsec_a_slip','zimsec_a_cert','birth_certificate','other');
CREATE TYPE document_status    AS ENUM ('uploaded','processing','extracted','failed','confirmed','approved','rejected');
CREATE TYPE ocr_engine         AS ENUM ('paddle','tesseract','llm','manual');
CREATE TYPE exam_level         AS ENUM ('O','A');
CREATE TYPE exam_session       AS ENUM ('JUNE','NOVEMBER');
CREATE TYPE zimsec_verification AS ENUM ('unverified','pending','verified','mismatch');
CREATE TYPE flag_severity      AS ENUM ('low','medium','high','block');
CREATE TYPE programme_level    AS ENUM ('certificate','diploma','higher_national_diploma','degree','short_course');
CREATE TYPE study_mode         AS ENUM ('full_time','part_time','block_release','online');
CREATE TYPE student_status     AS ENUM ('active','suspended','deferred','withdrawn','graduated');
CREATE TYPE lecturer_role      AS ENUM ('lead','assistant','tutor');
CREATE TYPE assessment_kind    AS ENUM ('test','assignment','practical','project','exam');
CREATE TYPE submission_mode    AS ENUM ('online','physical','none');
CREATE TYPE submission_status  AS ENUM ('draft','submitted','late','marked','returned');
CREATE TYPE visibility_scope   AS ENUM ('public','applicants','students','staff','programme','offering');
CREATE TYPE notif_channel      AS ENUM ('in_app','push','email','sms');
CREATE TYPE notif_category     AS ENUM ('deadline','announcement','result','library','application','system');
CREATE TYPE chat_role          AS ENUM ('user','assistant');
CREATE TYPE dsr_kind           AS ENUM ('access','correction','deletion','objection');
CREATE TYPE dsr_status         AS ENUM ('received','in_progress','completed','rejected');

-- =============================================================================
-- 1. Identity & access
-- =============================================================================
-- Accounts live in Authentik (docs/10-authentication.md). This table is the
-- portal-side anchor for foreign keys plus a cache of identity claims.
-- No passwords, MFA secrets or OTP codes are stored here.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idp_subject    text NOT NULL UNIQUE,                                    -- OIDC `sub` (Authentik user UUID)
  idp_user_pk    integer UNIQUE,                                          -- Authentik numeric pk, for API calls
  username       text,                                                    -- claim cache
  email          citext UNIQUE,                                           -- claim cache
  email_verified boolean NOT NULL DEFAULT false,                          -- claim cache
  phone          text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),      -- E.164, e.g. +263771234567
  display_name   text,
  is_active      boolean NOT NULL DEFAULT true,                           -- false once Authentik disables the account
  claims_synced_at timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Mirror of Authentik group membership (portal-students → 'student', …),
-- rewritten from the `groups` claim at every login and token refresh.
CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       user_role NOT NULL,
  idp_group  text NOT NULL,                                               -- e.g. 'portal-lecturers'
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Backend-for-frontend sessions: the browser holds only an opaque cookie.
CREATE TABLE web_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cookie_hash        bytea NOT NULL UNIQUE,                               -- sha256 of the cookie value
  idp_sid            text,                                                -- OIDC `sid`, for back-channel logout
  refresh_token_enc  bytea,                                               -- AES-GCM (SESSION_ENCRYPTION_KEY)
  id_token_enc       bytea,                                               -- for RP-initiated logout hint
  access_expires_at  timestamptz,
  user_agent         text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text                                                 -- 'logout','idp_disabled','admin',...
);
CREATE INDEX ON web_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ON web_sessions (idp_sid) WHERE revoked_at IS NULL;

-- Idempotency log for webhooks from Authentik notification rules.
CREATE TABLE idp_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_uuid   uuid NOT NULL UNIQUE,
  action       text NOT NULL,                                             -- 'model_updated', 'login_failed', …
  idp_user_pk  integer,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- One row per human. Personal details live here, not on users, so an applicant's
-- record carries over unchanged when they become a student.
CREATE TABLE people (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  surname            text NOT NULL,
  first_names        text NOT NULL,
  preferred_name     text,
  date_of_birth      date,
  gender             gender,
  national_id_enc    bytea,                                              -- AES-GCM ciphertext (app key, not in DB)
  national_id_hmac   bytea UNIQUE,                                       -- HMAC-SHA256 of normalized ID, for lookups/duplicates
  national_id_masked text,                                               -- '63-20•••••Q 29' for display
  national_id_valid  boolean,                                            -- mod-23 check result
  id_reg_district    char(2),
  id_origin_district char(2),
  nationality        char(2) DEFAULT 'ZW',                               -- ISO 3166-1 alpha-2
  address            text,
  next_of_kin_name   text,
  next_of_kin_phone  text,
  photo_object_key   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_name_trgm ON people USING gin ((surname || ' ' || first_names) gin_trgm_ops);

-- =============================================================================
-- 2. Reference data (admin-editable)
-- =============================================================================
CREATE TABLE district_codes (
  code      char(2) PRIMARY KEY CHECK (code ~ '^[0-9]{2}$'),
  district  text NOT NULL,
  province  text,
  notes     text                                                         -- e.g. 'conflicting sources: also listed as Chivi'
);

CREATE TABLE zimsec_subjects (
  code      text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  level     exam_level NOT NULL,
  name      text NOT NULL,
  aliases   text[] NOT NULL DEFAULT '{}',                                -- OCR/fuzzy-match alternatives
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (code, level)
);

-- =============================================================================
-- 3. Academic structure
-- =============================================================================
CREATE TABLE departments (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code  text NOT NULL UNIQUE,
  name  text NOT NULL,
  head_person_id uuid REFERENCES people(id)
);

CREATE TABLE grading_scales (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE
);
CREATE TABLE grading_bands (
  scale_id  uuid NOT NULL REFERENCES grading_scales(id) ON DELETE CASCADE,
  grade     text NOT NULL,                                               -- 'Distinction', 'Merit', 'Pass', 'Fail' or 'A'..'F'
  min_mark  numeric(5,2) NOT NULL CHECK (min_mark BETWEEN 0 AND 100),
  max_mark  numeric(5,2) NOT NULL CHECK (max_mark BETWEEN 0 AND 100),
  grade_points numeric(3,2),
  is_pass   boolean NOT NULL,
  PRIMARY KEY (scale_id, grade),
  CHECK (min_mark <= max_mark)
);

CREATE TABLE programmes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,                                  -- e.g. 'DIT'
  name            text NOT NULL,
  level           programme_level NOT NULL,
  department_id   uuid REFERENCES departments(id),
  duration_terms  smallint NOT NULL CHECK (duration_terms > 0),
  grading_scale_id uuid REFERENCES grading_scales(id),
  entry_rules     jsonb NOT NULL DEFAULT '{}'::jsonb,                    -- see docs/03 §3.5
  is_accepting_applications boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE academic_terms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,                                       -- '2027-S1'
  name       text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  CHECK (starts_on < ends_on)
);
CREATE UNIQUE INDEX academic_terms_one_current ON academic_terms (is_current) WHERE is_current;

CREATE TABLE intakes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                                      -- '2027-FEB'
  name        text NOT NULL,
  first_term_id uuid REFERENCES academic_terms(id),
  opens_at    timestamptz NOT NULL,
  closes_at   timestamptz NOT NULL,
  CHECK (opens_at < closes_at)
);

CREATE TABLE modules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,                                     -- e.g. 'DCN201'
  name         text NOT NULL,
  description  text,
  credits      smallint NOT NULL CHECK (credits > 0),
  department_id uuid REFERENCES departments(id),
  coursework_weight numeric(5,2) NOT NULL DEFAULT 40 CHECK (coursework_weight BETWEEN 0 AND 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- A module can belong to several programmes, at different points in each.
CREATE TABLE programme_modules (
  programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  module_id    uuid NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
  term_number  smallint NOT NULL CHECK (term_number > 0),                -- 1 = first term of the programme
  is_core      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (programme_id, module_id)
);

CREATE TABLE venues (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,                                        -- 'LAB-3'
  name      text NOT NULL,
  building  text,
  capacity  integer CHECK (capacity > 0)
);

-- =============================================================================
-- 4. People in academic roles
-- =============================================================================
CREATE TABLE staff (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid NOT NULL UNIQUE REFERENCES people(id),
  staff_number     text NOT NULL UNIQUE,
  title            text,                                                 -- 'Mr', 'Dr', 'Eng.'
  department_id    uuid REFERENCES departments(id),
  office           text,
  work_email       citext,
  work_phone       text,
  show_phone_to_students boolean NOT NULL DEFAULT false,
  consultation_hours text,
  bio              text,
  is_active        boolean NOT NULL DEFAULT true
);

CREATE TABLE students (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL UNIQUE REFERENCES people(id),
  student_number  text NOT NULL UNIQUE,
  programme_id    uuid NOT NULL REFERENCES programmes(id),
  intake_id       uuid REFERENCES intakes(id),
  application_id  uuid,                                                  -- FK added after applications
  study_mode      study_mode NOT NULL DEFAULT 'full_time',
  current_term_number smallint NOT NULL DEFAULT 1,
  class_group     text,                                                  -- default group, e.g. 'DIT-1A'
  status          student_status NOT NULL DEFAULT 'active',
  fees_cleared    boolean NOT NULL DEFAULT false,                         -- synced from finance
  fees_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON students (programme_id, current_term_number);

-- =============================================================================
-- 5. Onboarding: applications, documents, OCR, ZIMSEC results
-- =============================================================================
CREATE TABLE applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES people(id),
  intake_id            uuid NOT NULL REFERENCES intakes(id),
  programme_id         uuid NOT NULL REFERENCES programmes(id),
  second_choice_programme_id uuid REFERENCES programmes(id),
  study_mode           study_mode NOT NULL DEFAULT 'full_time',
  status               application_status NOT NULL DEFAULT 'draft',
  eligibility          eligibility_result,
  eligibility_detail   jsonb,                                            -- rule-by-rule explanation
  risk_score           integer NOT NULL DEFAULT 0,
  assigned_to          uuid REFERENCES users(id),                        -- admissions officer
  decided_by           uuid REFERENCES users(id),
  decided_at           timestamptz,
  decision_reason      text,
  consent_processing_at timestamptz,                                     -- privacy notice accepted
  consent_ai_at        timestamptz,                                      -- opted in to external AI extraction
  submitted_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, intake_id, programme_id)
);
CREATE INDEX applications_queue ON applications (status, risk_score DESC, submitted_at)
  WHERE status IN ('submitted','in_review','more_info');

ALTER TABLE students
  ADD CONSTRAINT students_application_fk FOREIGN KEY (application_id) REFERENCES applications(id);

CREATE TABLE application_events (                                        -- status history + comments
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES users(id),
  from_status    application_status,
  to_status      application_status,
  comment        text,
  visible_to_applicant boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON application_events (application_id, created_at);

-- "Continue on your phone": a single-use link that gives a phone a short-lived,
-- onboarding-only session for one application (docs/10 §10.10).
CREATE TABLE device_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,                                  -- sha256 of the QR token
  short_code_hash bytea NOT NULL UNIQUE,                                  -- sha256 of the typed code
  match_code      char(4) NOT NULL,                                       -- shown on both screens
  start_step      text NOT NULL,                                          -- 'national_id', 'zimsec', …
  sent_via        text CHECK (sent_via IN ('qr','sms','email')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  claim_expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  claimed_at      timestamptz,
  claimed_user_agent text,
  claimed_ip      inet,
  session_hash    bytea UNIQUE,                                           -- sha256 of the phone's cookie
  session_expires_at timestamptz,
  revoked_at      timestamptz,
  CHECK (claimed_at IS NULL OR claimed_at <= claim_expires_at),
  CHECK ((claimed_at IS NULL) = (session_hash IS NULL))
);
CREATE INDEX ON device_handoffs (application_id) WHERE revoked_at IS NULL;

CREATE TABLE documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  handoff_id     uuid REFERENCES device_handoffs(id) ON DELETE SET NULL,  -- set when uploaded from a phone
  kind           document_kind NOT NULL,
  detected_kind  document_kind,                                          -- classifier's opinion
  status         document_status NOT NULL DEFAULT 'uploaded',
  object_key     text NOT NULL,                                          -- MinIO key of the original
  mime_type      text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  sha256         bytea NOT NULL,
  page_count     smallint NOT NULL DEFAULT 1,
  quality_score  numeric(4,3),                                           -- 0..1 from preprocessing
  ocr_engine     ocr_engine,
  ocr_text       text,                                                   -- deleted after approval (retention)
  ocr_confidence numeric(4,3),
  extracted      jsonb,                                                  -- full structured extraction
  error          text,
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON documents (application_id);
CREATE INDEX ON documents (sha256);                                      -- duplicate uploads across applicants
CREATE INDEX ON documents (status) WHERE status IN ('uploaded','processing');

-- One row per extracted field, so the review screen can show confidence, the
-- image region, and what the applicant changed.
CREATE TABLE document_fields (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field           text NOT NULL,                                         -- 'national_id', 'subjects[3].grade'
  ocr_value       text,
  llm_value       text,
  confirmed_value text,
  confidence      numeric(4,3),
  bbox            jsonb,                                                 -- {"page":1,"x":..,"y":..,"w":..,"h":..}
  edited_by_applicant boolean GENERATED ALWAYS AS
                   (confirmed_value IS DISTINCT FROM COALESCE(llm_value, ocr_value)) STORED,
  UNIQUE (document_id, field)
);

CREATE TABLE exam_sittings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_id      uuid REFERENCES documents(id) ON DELETE SET NULL,
  level            exam_level NOT NULL,
  session          exam_session NOT NULL,
  year             smallint NOT NULL CHECK (year BETWEEN 1980 AND 2100),
  centre_number    char(6) NOT NULL CHECK (centre_number ~ '^[0-9]{6}$'),
  candidate_number char(4) NOT NULL CHECK (candidate_number ~ '^[0-9]{4}$'),
  candidate_name   text NOT NULL,
  verification     zimsec_verification NOT NULL DEFAULT 'unverified',
  verified_at      timestamptz,
  verification_note text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Same ZIMSEC candidate claimed on two applications is a fraud signal, so it
-- is indexed (not UNIQUE: one person may legitimately apply to two intakes).
CREATE INDEX exam_sittings_candidate ON exam_sittings (level, session, year, centre_number, candidate_number);

CREATE TABLE exam_subject_results (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sitting_id   uuid NOT NULL REFERENCES exam_sittings(id) ON DELETE CASCADE,
  subject_code text CHECK (subject_code ~ '^[0-9]{4}$'),
  subject_name text NOT NULL,
  grade        text NOT NULL CHECK (grade IN ('A','B','C','D','E','O','F','U','X','M','M-W','M-W-N')),
  UNIQUE (sitting_id, subject_name)
);

CREATE TABLE application_flags (                                          -- risk signals
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_id    uuid REFERENCES documents(id) ON DELETE CASCADE,
  code           text NOT NULL,                                          -- 'ID_CHECK_FAILED','DUPLICATE_CANDIDATE',...
  severity       flag_severity NOT NULL,
  detail         jsonb,
  resolved_by    uuid REFERENCES users(id),
  resolved_at    timestamptz,
  resolution     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON application_flags (application_id) WHERE resolved_at IS NULL;

CREATE TABLE zimsec_verification_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference   text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES users(id),
  exported_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  export_object_key text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE zimsec_verification_items (
  batch_id   uuid NOT NULL REFERENCES zimsec_verification_batches(id) ON DELETE CASCADE,
  sitting_id uuid NOT NULL REFERENCES exam_sittings(id) ON DELETE CASCADE,
  outcome    zimsec_verification NOT NULL DEFAULT 'pending',
  note       text,
  PRIMARY KEY (batch_id, sitting_id)
);

-- =============================================================================
-- 6. Teaching: offerings, lecturers, enrolments, timetable
-- =============================================================================
CREATE TABLE module_offerings (                                           -- a module taught in a term to a class group
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id    uuid NOT NULL REFERENCES modules(id),
  term_id      uuid NOT NULL REFERENCES academic_terms(id),
  class_group  text NOT NULL,                                            -- 'DIT-1A'
  study_mode   study_mode NOT NULL DEFAULT 'full_time',
  lms_course_id text,                                                    -- external LMS link (Moodle etc.)
  results_published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, term_id, class_group)
);
CREATE INDEX ON module_offerings (term_id);

CREATE TABLE offering_lecturers (
  offering_id uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff(id),
  role        lecturer_role NOT NULL DEFAULT 'lead',
  PRIMARY KEY (offering_id, staff_id)
);
CREATE INDEX ON offering_lecturers (staff_id);

CREATE TABLE enrolments (
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  offering_id uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  is_repeat   boolean NOT NULL DEFAULT false,
  dropped_at  timestamptz,
  PRIMARY KEY (student_id, offering_id)
);
CREATE INDEX ON enrolments (offering_id) WHERE dropped_at IS NULL;

CREATE TABLE timetable_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),     -- ISO: 1 = Monday
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  venue_id    uuid REFERENCES venues(id),
  online_url  text,
  kind        text NOT NULL DEFAULT 'lecture' CHECK (kind IN ('lecture','tutorial','lab','consultation')),
  valid_from  date,
  valid_to    date,
  CHECK (starts_at < ends_at)
);
CREATE INDEX ON timetable_slots (offering_id);

CREATE TABLE timetable_exceptions (                                       -- cancellations / moves
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id     uuid NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  cancelled   boolean NOT NULL DEFAULT false,
  new_starts_at time,
  new_ends_at   time,
  new_venue_id  uuid REFERENCES venues(id),
  reason      text,
  UNIQUE (slot_id, on_date)
);

-- =============================================================================
-- 7. Assessments, submissions, results
-- =============================================================================
CREATE TABLE assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id     uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  kind            assessment_kind NOT NULL,
  title           text NOT NULL,
  description_md  text,
  topics          text[],
  opens_at        timestamptz,
  due_at          timestamptz NOT NULL,                                  -- test start time, or assignment deadline
  duration_minutes integer CHECK (duration_minutes > 0),
  venue_id        uuid REFERENCES venues(id),
  weight          numeric(5,2) NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  max_mark        numeric(6,2) NOT NULL DEFAULT 100 CHECK (max_mark > 0),
  submission_mode submission_mode NOT NULL DEFAULT 'online',
  allow_late_until timestamptz,
  allow_resubmission boolean NOT NULL DEFAULT true,
  marks_released_at timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  published_at    timestamptz,                                           -- NULL = draft, hidden from students
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at IS NULL OR opens_at <= due_at)
);
CREATE INDEX assessments_upcoming ON assessments (offering_id, due_at) WHERE published_at IS NOT NULL;

CREATE TABLE submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status        submission_status NOT NULL DEFAULT 'draft',
  submitted_at  timestamptz,
  mark          numeric(6,2) CHECK (mark >= 0),
  feedback_md   text,
  marked_by     uuid REFERENCES users(id),
  marked_at     timestamptz,
  UNIQUE (assessment_id, student_id)
);

CREATE TABLE submission_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  object_key    text NOT NULL,
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL,
  sha256        bytea NOT NULL,                                          -- receipt shown to the student
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE module_results (                                             -- final result per student per offering
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  offering_id     uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  coursework_mark numeric(5,2) CHECK (coursework_mark BETWEEN 0 AND 100),
  exam_mark       numeric(5,2) CHECK (exam_mark BETWEEN 0 AND 100),
  final_mark      numeric(5,2) CHECK (final_mark BETWEEN 0 AND 100),
  grade           text,
  is_pass         boolean,
  remarks         text,                                                  -- 'Supplementary', 'Absent', ...
  entered_by      uuid REFERENCES users(id),
  approved_by     uuid REFERENCES users(id),                             -- registry / exam board
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, offering_id)
);
-- Students see a result only when module_offerings.results_published_at is set.

-- =============================================================================
-- 8. Content: notes, announcements
-- =============================================================================
CREATE TABLE course_materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id  uuid NOT NULL REFERENCES module_offerings(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  week         smallint CHECK (week BETWEEN 1 AND 52),
  topic        text,
  object_key   text,                                                     -- file in MinIO
  external_url text,                                                     -- or a link (video, LMS page)
  mime_type    text,
  size_bytes   integer,
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (object_key IS NOT NULL OR external_url IS NOT NULL)
);
CREATE INDEX ON course_materials (offering_id, week) WHERE published_at IS NOT NULL;

CREATE TABLE announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body_md      text NOT NULL,
  author_id    uuid NOT NULL REFERENCES users(id),
  is_pinned    boolean NOT NULL DEFAULT false,
  requires_ack boolean NOT NULL DEFAULT false,
  publish_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > publish_at)
);
CREATE INDEX ON announcements (publish_at DESC);

-- Each row is one OR-ed audience rule; within a row, non-NULL columns are AND-ed.
-- A row with everything NULL means "everyone signed in".
CREATE TABLE announcement_targets (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  role            user_role,
  programme_id    uuid REFERENCES programmes(id) ON DELETE CASCADE,
  term_number     smallint,                                              -- "year/term of study"
  offering_id     uuid REFERENCES module_offerings(id) ON DELETE CASCADE,
  intake_id       uuid REFERENCES intakes(id) ON DELETE CASCADE
);
CREATE INDEX ON announcement_targets (announcement_id);

CREATE TABLE announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE attachments (                                                -- files on announcements
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid REFERENCES announcements(id) ON DELETE CASCADE,
  assessment_id   uuid REFERENCES assessments(id) ON DELETE CASCADE,
  object_key      text NOT NULL,
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      integer NOT NULL,
  CHECK (num_nonnulls(announcement_id, assessment_id) = 1)
);

-- =============================================================================
-- 9. Library
-- =============================================================================
CREATE TABLE library_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isbn          text,
  title         text NOT NULL,
  authors       text[] NOT NULL DEFAULT '{}',
  publisher     text,
  year          smallint,
  subjects      text[] NOT NULL DEFAULT '{}',
  call_number   text,
  e_resource_url text,
  external_id   text UNIQUE,                                             -- Koha biblionumber, if integrated
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_items_title_trgm ON library_items USING gin (title gin_trgm_ops);
CREATE INDEX ON library_items (isbn);

CREATE TABLE library_copies (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id   uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  barcode   text NOT NULL UNIQUE,
  location  text,                                                        -- shelf / branch
  status    text NOT NULL DEFAULT 'available'
            CHECK (status IN ('available','on_loan','reference_only','lost','repair'))
);

CREATE TABLE library_loans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_id      uuid NOT NULL REFERENCES library_copies(id),
  person_id    uuid NOT NULL REFERENCES people(id),
  borrowed_at  timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL,
  returned_at  timestamptz,
  renewals     smallint NOT NULL DEFAULT 0,
  fine_amount  numeric(10,2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
  fine_currency char(3) NOT NULL DEFAULT 'USD',
  fine_paid_at timestamptz
);
CREATE UNIQUE INDEX library_one_open_loan_per_copy ON library_loans (copy_id) WHERE returned_at IS NULL;
CREATE INDEX ON library_loans (person_id) WHERE returned_at IS NULL;

CREATE TABLE library_pages (                                              -- hours, rules, e-resources, contacts
  slug       text PRIMARY KEY,
  title      text NOT NULL,
  body_md    text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 10. AI assistant: knowledge base and chat
-- =============================================================================
-- A source document for retrieval (a note, handbook section, announcement, library page).
CREATE TABLE kb_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type  text NOT NULL CHECK (source_type IN ('material','announcement','library_page','handbook','assessment')),
  source_id    text NOT NULL,                                            -- id of the source row (uuid or slug)
  title        text NOT NULL,
  visibility   visibility_scope NOT NULL,
  programme_id uuid REFERENCES programmes(id) ON DELETE CASCADE,         -- when visibility = 'programme'
  offering_id  uuid REFERENCES module_offerings(id) ON DELETE CASCADE,   -- when visibility = 'offering'
  content_hash bytea NOT NULL,                                           -- skip re-embedding unchanged content
  indexed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  CHECK (visibility <> 'programme' OR programme_id IS NOT NULL),
  CHECK (visibility <> 'offering'  OR offering_id  IS NOT NULL)
);

CREATE TABLE kb_chunks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  token_count integer,
  embedding   vector(1024) NOT NULL,                                     -- BAAI/bge-m3
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE chat_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON chat_sessions (user_id, last_message_at DESC);

CREATE TABLE chat_messages (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          chat_role NOT NULL,
  content       jsonb NOT NULL,                                          -- full API content blocks (append-only history)
  text_preview  text,                                                    -- plain text for the UI list
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cache_read_tokens integer,
  cited_chunk_ids bigint[],
  feedback      smallint CHECK (feedback IN (-1, 1)),
  feedback_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON chat_messages (session_id, id);
CREATE INDEX chat_messages_created ON chat_messages (created_at);         -- retention job

-- =============================================================================
-- 11. Notifications
-- =============================================================================
CREATE TABLE notification_preferences (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category notif_category NOT NULL,
  channel  notif_channel NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    notif_category NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,                                                      -- in-app route, e.g. '/modules/…'
  dedupe_key  text,                                                      -- 'assessment:<id>:24h' stops duplicate reminders
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         notif_channel NOT NULL,
  status          text NOT NULL CHECK (status IN ('queued','sent','failed')),
  provider_ref    text,
  error           text,
  attempted_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 12. Compliance: audit, data subject requests, retention
-- =============================================================================
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,                                                      -- no FK: keep the log after user deletion
  actor_role  user_role,
  action      text NOT NULL,                                             -- 'document.view','application.approve',...
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
-- Monthly partitions are created ahead of time by a scheduled job, e.g.:
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
CREATE INDEX ON audit_log (entity, entity_id, at);
CREATE INDEX ON audit_log (actor_id, at);

CREATE TABLE data_subject_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid REFERENCES people(id) ON DELETE SET NULL,
  kind         dsr_kind NOT NULL,
  status       dsr_status NOT NULL DEFAULT 'received',
  details      text,
  handled_by   uuid REFERENCES users(id),
  received_at  timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL DEFAULT now() + interval '30 days',
  completed_at timestamptz,
  outcome      text
);

CREATE TABLE retention_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy      text NOT NULL,                                             -- 'rejected_application_docs', 'chat_transcripts'
  deleted_rows integer NOT NULL,
  deleted_objects integer NOT NULL DEFAULT 0,
  ran_at      timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 13. Integration bookkeeping
-- =============================================================================
CREATE TABLE import_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,                                             -- 'csv:students', 'moodle', 'koha', 'finance'
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created     integer NOT NULL DEFAULT 0,
  updated     integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  errors      jsonb,
  started_by  uuid REFERENCES users(id)
);

-- =============================================================================
-- updated_at triggers
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','people','programmes','modules','students','applications',
                           'documents','assessments','announcements']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- =============================================================================
-- Views used by the API
-- =============================================================================

-- Current, active enrolments with module and term, for the dashboard.
CREATE VIEW v_student_current_modules AS
SELECT e.student_id, o.id AS offering_id, m.code AS module_code, m.name AS module_name,
       m.credits, o.class_group, t.code AS term_code
FROM enrolments e
JOIN module_offerings o ON o.id = e.offering_id
JOIN modules m          ON m.id = o.module_id
JOIN academic_terms t   ON t.id = o.term_id
WHERE e.dropped_at IS NULL AND t.is_current;

-- Upcoming published assessments per student ("due soon").
CREATE VIEW v_student_upcoming_assessments AS
SELECT e.student_id, a.id AS assessment_id, a.kind, a.title, a.due_at, a.venue_id,
       m.code AS module_code, m.name AS module_name,
       s.status AS submission_status
FROM enrolments e
JOIN assessments a      ON a.offering_id = e.offering_id AND a.published_at IS NOT NULL
JOIN module_offerings o ON o.id = e.offering_id
JOIN modules m          ON m.id = o.module_id
LEFT JOIN submissions s ON s.assessment_id = a.id AND s.student_id = e.student_id
WHERE e.dropped_at IS NULL AND a.due_at >= now();

-- Published results only: what a student is allowed to see.
CREATE VIEW v_student_published_results AS
SELECT r.student_id, o.id AS offering_id, t.code AS term_code, m.code AS module_code,
       m.name AS module_name, m.credits, r.coursework_mark, r.exam_mark, r.final_mark,
       r.grade, r.is_pass, r.remarks
FROM module_results r
JOIN module_offerings o ON o.id = r.offering_id
JOIN modules m          ON m.id = o.module_id
JOIN academic_terms t   ON t.id = o.term_id
WHERE o.results_published_at IS NOT NULL AND o.results_published_at <= now();

-- Knowledge-base documents a given user may retrieve. Used by the assistant as
--   SELECT … FROM kb_chunks c JOIN kb_visible_documents($1) d ON d.id = c.document_id
--   ORDER BY c.embedding <=> $2 LIMIT 8;
CREATE FUNCTION kb_visible_documents(p_user uuid) RETURNS SETOF kb_documents
LANGUAGE sql STABLE AS $$
  WITH roles AS (SELECT role FROM user_roles WHERE user_id = p_user),
       stu AS (
         SELECT s.id, s.programme_id FROM students s
         JOIN people p ON p.id = s.person_id
         WHERE p.user_id = p_user AND s.status = 'active'
       )
  SELECT d.* FROM kb_documents d
  WHERE d.visibility = 'public'
     OR (d.visibility = 'applicants' AND EXISTS (SELECT 1 FROM roles WHERE role = 'applicant'))
     OR (d.visibility = 'students'   AND EXISTS (SELECT 1 FROM stu))
     OR (d.visibility = 'staff'      AND EXISTS (SELECT 1 FROM roles WHERE role NOT IN ('applicant','student')))
     OR (d.visibility = 'programme'  AND d.programme_id IN (SELECT programme_id FROM stu))
     OR (d.visibility = 'offering'   AND d.offering_id IN (
           SELECT e.offering_id FROM enrolments e JOIN stu ON stu.id = e.student_id
           WHERE e.dropped_at IS NULL
           UNION
           SELECT ol.offering_id FROM offering_lecturers ol
           JOIN staff st ON st.id = ol.staff_id
           JOIN people p ON p.id = st.person_id
           WHERE p.user_id = p_user))
$$;

-- Announcements a user should see now. A target row matches when every non-NULL
-- column matches the user; any matching row makes the announcement visible.
CREATE FUNCTION announcements_for_user(p_user uuid) RETURNS SETOF announcements
LANGUAGE sql STABLE AS $$
  WITH roles AS (SELECT role FROM user_roles WHERE user_id = p_user),
       stu AS (
         SELECT s.id, s.programme_id, s.current_term_number, s.intake_id FROM students s
         JOIN people p ON p.id = s.person_id
         WHERE p.user_id = p_user AND s.status = 'active'
       ),
       my_offerings AS (
         SELECT e.offering_id FROM enrolments e JOIN stu ON stu.id = e.student_id WHERE e.dropped_at IS NULL
         UNION
         SELECT ol.offering_id FROM offering_lecturers ol
         JOIN staff st ON st.id = ol.staff_id JOIN people p ON p.id = st.person_id
         WHERE p.user_id = p_user
       ),
       my_intakes AS (
         SELECT intake_id FROM stu WHERE intake_id IS NOT NULL
         UNION
         SELECT a.intake_id FROM applications a JOIN people p ON p.id = a.person_id WHERE p.user_id = p_user
       )
  SELECT a.* FROM announcements a
  WHERE a.publish_at <= now()
    AND (a.expires_at IS NULL OR a.expires_at > now())
    AND EXISTS (
      SELECT 1 FROM announcement_targets t
      WHERE t.announcement_id = a.id
        AND (t.role         IS NULL OR t.role IN (SELECT role FROM roles))
        AND (t.programme_id IS NULL OR t.programme_id IN (SELECT programme_id FROM stu))
        AND (t.term_number  IS NULL OR t.term_number  IN (SELECT current_term_number FROM stu))
        AND (t.offering_id  IS NULL OR t.offering_id  IN (SELECT offering_id FROM my_offerings))
        AND (t.intake_id    IS NULL OR t.intake_id    IN (SELECT intake_id FROM my_intakes)))
$$;
