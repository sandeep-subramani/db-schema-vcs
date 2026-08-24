-- The shape `pg_dump --schema-only` actually emits: session SETs, the
-- table split from its sequence and its keys, ownership, indexes and
-- comments. Every table still lands; the noise around them shows up in
-- the skip list with a reason per line.

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(60) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE public.teams OWNER TO app_owner;

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);

CREATE TABLE public.projects (
    id bigint NOT NULL,
    team_id integer NOT NULL,
    name character varying(200) NOT NULL,
    archived boolean NOT NULL,
    budget numeric(12,2),
    starts_on date
);

ALTER TABLE public.projects OWNER TO app_owner;

ALTER TABLE public.projects ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    done boolean NOT NULL,
    due_at timestamp without time zone
);

ALTER TABLE public.tasks OWNER TO app_owner;

ALTER TABLE public.tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX tasks_project_id_idx ON public.tasks USING btree (project_id);

CREATE INDEX tasks_due_at_idx ON public.tasks USING btree (due_at);

COMMENT ON TABLE public.tasks IS 'One row per unit of work.';
