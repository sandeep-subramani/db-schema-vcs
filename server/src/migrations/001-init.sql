-- 001-init.sql — the app's own storage tables (decisions.md #12, #13).
-- Naming note: "schema" in this project usually means the versioned
-- artifact; those live here as opaque JSONB snapshots and never
-- migrate. These migrations only build the app's own tables.

CREATE TABLE users (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username   text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A repo carries its member list in a column instead of a join table
-- (decisions.md #13). Members are usernames: usernames are the whole
-- identity and there is no rename feature to break them.
CREATE TABLE repos (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  owner      text NOT NULL REFERENCES users (username),
  members    text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, name)
);

-- A branch records its parent and the snapshot it was created from —
-- the stored merge base that keeps merges graph-search-free
-- (decisions.md #7) — plus the explicitly saved working state and its
-- save marker, the one-column staleness check of decisions.md #15.
CREATE TABLE branches (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_id          integer NOT NULL REFERENCES repos (id) ON DELETE CASCADE,
  name             text NOT NULL,
  parent_branch_id integer REFERENCES branches (id) ON DELETE CASCADE,
  base_snapshot    jsonb NOT NULL,
  working_snapshot jsonb NOT NULL,
  working_rev      integer NOT NULL DEFAULT 0,
  working_saved_by text,
  working_saved_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_id, name)
);

-- Whole snapshot per commit (decisions.md #12): any version is one
-- row read, and diffing two versions is reading two rows.
CREATE TABLE commits (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id  integer NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  message    text NOT NULL,
  snapshot   jsonb NOT NULL,
  author     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commits_branch_idx ON commits (branch_id, id DESC);
