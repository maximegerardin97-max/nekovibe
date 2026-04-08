-- Zendesk Integration Schema
-- Run this in the Supabase SQL editor before triggering the daily refresh

-- ─── Zendesk Tickets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zendesk_tickets (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id      BIGINT NOT NULL UNIQUE,
  subject          TEXT,
  description      TEXT,
  status           TEXT,
  priority         TEXT,
  group_name       TEXT,
  category         TEXT,      -- "Closing Ticket Category" (field 5440588879903)
  contact_reason   TEXT,      -- "Contact Reason" (field 5435523165855)
  clinic_name      TEXT,      -- mapped from group_name
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
  solved_at        TIMESTAMPTZ,
  raw_data         JSONB
);

ALTER TABLE zendesk_tickets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'zendesk_tickets' AND policyname = 'anon read zendesk_tickets'
  ) THEN
    CREATE POLICY "anon read zendesk_tickets"
      ON zendesk_tickets FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ─── Zendesk CSAT ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zendesk_csat (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id  BIGINT NOT NULL UNIQUE,
  ticket_id    BIGINT,
  rating       INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment      TEXT,
  clinic_name  TEXT,
  created_at   TIMESTAMPTZ,
  raw_data     JSONB
);

ALTER TABLE zendesk_csat ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'zendesk_csat' AND policyname = 'anon read zendesk_csat'
  ) THEN
    CREATE POLICY "anon read zendesk_csat"
      ON zendesk_csat FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_created_at ON zendesk_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_clinic_name ON zendesk_tickets (clinic_name);
CREATE INDEX IF NOT EXISTS idx_zendesk_tickets_status ON zendesk_tickets (status);
CREATE INDEX IF NOT EXISTS idx_zendesk_csat_created_at ON zendesk_csat (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zendesk_csat_clinic_name ON zendesk_csat (clinic_name);
CREATE INDEX IF NOT EXISTS idx_zendesk_csat_rating ON zendesk_csat (rating);
