CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, full_name text NOT NULL, display_name text NOT NULL DEFAULT '', email text NOT NULL,
    password_hash text NOT NULL, platform_role text NOT NULL DEFAULT 'user', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE users SET platform_role = 'user' WHERE platform_role IS NULL;
UPDATE users SET platform_role = 'user' WHERE platform_role NOT IN ('user', 'admin');
ALTER TABLE users ALTER COLUMN platform_role SET DEFAULT 'user';
ALTER TABLE users ALTER COLUMN platform_role SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_platform_role_check') THEN
  ALTER TABLE users ADD CONSTRAINT users_platform_role_check CHECK (platform_role IN ('user','admin'));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS workspaces (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'owner', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, user_id)
);
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS role text DEFAULT 'member';
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE workspace_memberships SET role='viewer' WHERE role IS NULL OR role='member' OR role NOT IN ('owner','operator','viewer');
ALTER TABLE workspace_memberships ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE workspace_memberships ALTER COLUMN role SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='workspace_memberships'::regclass AND conname='workspace_memberships_role_check') THEN
  ALTER TABLE workspace_memberships ADD CONSTRAINT workspace_memberships_role_check CHECK (role IN ('owner','operator','viewer'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx ON workspace_memberships (user_id);

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash bytea;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
