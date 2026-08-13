CREATE TABLE IF NOT EXISTS paper_summaries (
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('short', 'full')),
  content TEXT NOT NULL,
  model TEXT,
  document_version TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, kind)
);

ALTER TABLE papers ADD COLUMN IF NOT EXISTS share_public_id TEXT UNIQUE;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;
