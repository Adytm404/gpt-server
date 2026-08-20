ALTER TABLE ai_models
    ADD COLUMN IF NOT EXISTS api_key_ciphertext bytea;

UPDATE ai_models
SET credential_configured = (api_key_ciphertext IS NOT NULL OR credential_ref IS NOT NULL);
