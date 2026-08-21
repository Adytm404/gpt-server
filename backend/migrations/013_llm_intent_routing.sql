ALTER TABLE operations ADD COLUMN IF NOT EXISTS response_language text NOT NULL DEFAULT 'en';

ALTER TABLE token_usage DROP CONSTRAINT IF EXISTS token_usage_phase_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_phase_check CHECK (phase IN ('routing','planning','summary','explain'));

DROP INDEX IF EXISTS token_usage_message_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS token_usage_message_phase_idx ON token_usage(message_id, phase) WHERE message_id IS NOT NULL;
