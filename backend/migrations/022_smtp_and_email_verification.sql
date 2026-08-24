CREATE TABLE IF NOT EXISTS platform_smtp_settings (
    id text PRIMARY KEY DEFAULT 'default',
    host text NOT NULL DEFAULT '',
    port integer NOT NULL DEFAULT 587,
    username text NOT NULL DEFAULT '',
    password_ciphertext bytea,
    from_email text NOT NULL DEFAULT '',
    from_name text NOT NULL DEFAULT 'OpsAI',
    encryption text NOT NULL DEFAULT 'starttls' CHECK (encryption IN ('tls', 'starttls', 'none')),
    enabled boolean NOT NULL DEFAULT false,
    require_email_verification boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS email_verification_tokens_hash_idx ON email_verification_tokens(token_hash);
