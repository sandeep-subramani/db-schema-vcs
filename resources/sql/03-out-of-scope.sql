-- Deliberately full of things this app does not version. Two tables
-- still import cleanly; everything else turns into a skip-list line
-- that names what was dropped and why. This is the file for judging
-- how honest the importer is about its own limits.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE ticket_state AS ENUM ('open', 'pending', 'closed');

CREATE TABLE accounts (
    id uuid PRIMARY KEY,
    email varchar(255) NOT NULL UNIQUE,
    display_name varchar(80) NOT NULL,
    locale char(2) NOT NULL,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags text[] NOT NULL DEFAULT '{}',
    trust_score real NOT NULL DEFAULT 0,
    session_length interval,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    id bigserial PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    state ticket_state NOT NULL DEFAULT 'open',
    subject varchar(200) NOT NULL,
    priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    amount numeric(10,2),
    opened_on date NOT NULL,
    UNIQUE (account_id, subject)
);

CREATE TABLE ticket_events (
    ticket_id bigint NOT NULL,
    seq integer NOT NULL,
    note text,
    PRIMARY KEY (ticket_id, seq),
    FOREIGN KEY (ticket_id, seq) REFERENCES tickets (id, id)
);

CREATE TABLE watchers (
    ticket_id bigint NOT NULL,
    account_id uuid NOT NULL REFERENCES accounts
);

CREATE INDEX tickets_state_idx ON tickets (state);

CREATE VIEW open_tickets AS
    SELECT id, subject FROM tickets WHERE state = 'open';

CREATE OR REPLACE FUNCTION touch_ticket() RETURNS trigger AS $$
BEGIN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_touch BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION touch_ticket();

GRANT SELECT ON tickets TO reporting;

INSERT INTO accounts (id, email, display_name, locale) VALUES
    ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'A', 'en');

\connect other_database
