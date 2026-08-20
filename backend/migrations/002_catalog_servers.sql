CREATE TABLE IF NOT EXISTS ai_models (
    id uuid PRIMARY KEY, external_model_id text NOT NULL UNIQUE, name text NOT NULL, provider text NOT NULL,
    context_window integer NOT NULL CHECK (context_window > 0), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    is_fallback boolean NOT NULL DEFAULT false, credential_configured boolean NOT NULL DEFAULT false, credential_ref text,
    last_test_latency_ms integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS external_model_id text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS context_window integer;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_fallback boolean NOT NULL DEFAULT false;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS credential_configured boolean NOT NULL DEFAULT false;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS credential_ref text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS last_test_latency_ms integer;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_external_model_id_idx ON ai_models(external_model_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_single_fallback_idx ON ai_models (is_fallback) WHERE is_fallback;

CREATE TABLE IF NOT EXISTS subscription_plans (
    id uuid PRIMARY KEY, slug text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS subscription_plan_revisions (
    id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT, revision integer NOT NULL,
    name text NOT NULL, slug text NOT NULL, description text NOT NULL DEFAULT '', price_cents integer NOT NULL CHECK (price_cents >= 0),
    annual_price_cents integer NOT NULL CHECK (annual_price_cents >= 0), status text NOT NULL CHECK (status IN ('draft','published','archived')),
    max_workspaces integer NOT NULL CHECK (max_workspaces >= 0), max_servers integer NOT NULL CHECK (max_servers >= 0),
    monthly_tokens bigint NOT NULL CHECK (monthly_tokens >= 0), input_tokens integer NOT NULL CHECK (input_tokens >= 0), output_tokens integer NOT NULL CHECK (output_tokens >= 0),
    over_limit text NOT NULL CHECK (over_limit IN ('block_requests','allow_with_warning')), default_model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT,
    fallback_model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT, features jsonb NOT NULL DEFAULT '[]', visibility text NOT NULL CHECK (visibility IN ('public','private')),
    subscribers integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(plan_id, revision)
);
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS annual_price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS max_workspaces integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS max_servers integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS monthly_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS over_limit text NOT NULL DEFAULT 'block_requests';
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS default_model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS fallback_model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]';
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS subscribers integer NOT NULL DEFAULT 0;
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscription_plan_revisions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE subscription_plans sp SET slug=r.slug FROM subscription_plan_revisions r
 WHERE r.plan_id=sp.id AND r.status IN ('draft','published') AND sp.slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plan_one_draft_idx ON subscription_plan_revisions(plan_id) WHERE status='draft';
CREATE UNIQUE INDEX IF NOT EXISTS plan_one_published_idx ON subscription_plan_revisions(plan_id) WHERE status='published';
DROP INDEX IF EXISTS plan_live_slug_idx;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_slug_idx ON subscription_plans(lower(slug)) WHERE slug IS NOT NULL;
CREATE TABLE IF NOT EXISTS plan_allowed_models (
    revision_id uuid NOT NULL REFERENCES subscription_plan_revisions(id) ON DELETE CASCADE,
    model_id uuid NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT, PRIMARY KEY(revision_id, model_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
    id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, event_type text NOT NULL,
    action text NOT NULL, target_id uuid, target_name text NOT NULL DEFAULT '', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_id uuid;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_name text NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
UPDATE audit_events SET event_type=COALESCE(NULLIF(event_type,''), 'system') WHERE event_type IS NULL OR event_type='';
UPDATE audit_events SET action='Legacy event' WHERE action IS NULL OR action='';
ALTER TABLE audit_events ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE audit_events ALTER COLUMN action SET NOT NULL;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='audit_events' AND column_name='workspace_id') THEN
  ALTER TABLE audit_events ALTER COLUMN workspace_id DROP NOT NULL;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS audit_events_lookup_idx ON audit_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS servers (
    id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name text NOT NULL, host text NOT NULL,
    port integer NOT NULL DEFAULT 22, ssh_user text NOT NULL, environment text NOT NULL, region text NOT NULL DEFAULT '', host_fingerprint text NOT NULL DEFAULT '',
    private_key_ciphertext bytea, status text NOT NULL DEFAULT 'unknown', last_error text NOT NULL DEFAULT '', last_checked_at timestamptz,
    deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS host text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS port integer DEFAULT 22;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_user text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS environment text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS region text DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS host_fingerprint text DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS private_key_ciphertext bytea;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS status text DEFAULT 'unknown';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_error text DEFAULT '';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE servers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE servers SET port=22 WHERE port IS NULL;
UPDATE servers SET region='' WHERE region IS NULL;
UPDATE servers SET host_fingerprint='' WHERE host_fingerprint IS NULL;
UPDATE servers SET status='unknown' WHERE status IS NULL;
UPDATE servers SET last_error='' WHERE last_error IS NULL;
CREATE INDEX IF NOT EXISTS servers_workspace_idx ON servers(workspace_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS server_health_snapshots (
    id uuid PRIMARY KEY, server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE, status text NOT NULL,
    latency_ms integer NOT NULL DEFAULT 0, cpu_percent numeric NOT NULL DEFAULT 0, memory_percent numeric NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT '', checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS latency_ms integer NOT NULL DEFAULT 0;
ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS cpu_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS memory_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS error text NOT NULL DEFAULT '';
ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS checked_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS server_health_server_idx ON server_health_snapshots(server_id, checked_at DESC);
