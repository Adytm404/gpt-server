CREATE TABLE IF NOT EXISTS platform_oauth_settings (
    provider text PRIMARY KEY,
    client_id text NOT NULL DEFAULT '',
    client_secret_ciphertext bytea,
    redirect_uri text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON users (google_id) WHERE google_id IS NOT NULL;
