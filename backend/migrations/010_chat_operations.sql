-- Replace the incompatible pre-versioned operation experiment only when it is empty.
DO $$
DECLARE
    incompatible boolean;
    operation_count bigint := 0;
    step_count bigint := 0;
    event_count bigint := 0;
BEGIN
    SELECT to_regclass(current_schema() || '.operations') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema=current_schema() AND table_name='operations' AND column_name='thread_id'
       ) INTO incompatible;
    IF incompatible THEN
        EXECUTE 'SELECT count(*) FROM operations' INTO operation_count;
        IF to_regclass(current_schema() || '.operation_steps') IS NOT NULL THEN
            EXECUTE 'SELECT count(*) FROM operation_steps' INTO step_count;
        END IF;
        IF to_regclass(current_schema() || '.operation_events') IS NOT NULL THEN
            EXECUTE 'SELECT count(*) FROM operation_events' INTO event_count;
        END IF;
        IF operation_count <> 0 OR step_count <> 0 OR event_count <> 0 THEN
            RAISE EXCEPTION 'incompatible legacy operation tables contain data; manual migration required';
        END IF;
        DROP TABLE IF EXISTS operation_events;
        DROP TABLE IF EXISTS operation_steps;
        DROP TABLE operations;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
    workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_revision_id uuid REFERENCES subscription_plan_revisions(id) ON DELETE RESTRICT,
    default_model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT,
    monthly_token_limit bigint NOT NULL DEFAULT 0 CHECK (monthly_token_limit >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_id_workspace_idx ON servers(id, workspace_id);

CREATE TABLE IF NOT EXISTS chat_threads (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id, workspace_id),
    FOREIGN KEY (server_id, workspace_id) REFERENCES servers(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS chat_threads_workspace_updated_idx ON chat_threads(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_threads_server_idx ON chat_threads(workspace_id, server_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id uuid PRIMARY KEY,
    thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user','assistant','system')),
    content text NOT NULL,
    model_id uuid REFERENCES ai_models(id) ON DELETE RESTRICT,
    input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx ON chat_messages(thread_id, created_at, id);

CREATE TABLE IF NOT EXISTS operations (
    id uuid PRIMARY KEY,
    thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    server_id uuid NOT NULL REFERENCES servers(id) ON DELETE RESTRICT,
    server_updated_at timestamptz NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    model_id uuid NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('planning','pending_approval','approved','running','succeeded','failed','rejected','cancelled')),
    policy text NOT NULL CHECK (policy IN ('approval_required','read_only')),
    risk text NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium')),
    title text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    error text NOT NULL DEFAULT '',
    approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    rejected_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id, workspace_id),
    FOREIGN KEY (thread_id, workspace_id) REFERENCES chat_threads(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (server_id, workspace_id) REFERENCES servers(id, workspace_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS operations_workspace_created_idx ON operations(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_thread_created_idx ON operations(workspace_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operations_server_active_idx ON operations(workspace_id, server_id) WHERE status IN ('approved','running');

CREATE TABLE IF NOT EXISTS operation_steps (
    id uuid PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    description text NOT NULL,
    executable text NOT NULL,
    args jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(args) = 'array'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
    exit_code integer,
    stdout text NOT NULL DEFAULT '',
    stderr text NOT NULL DEFAULT '',
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(operation_id, position)
);
CREATE INDEX IF NOT EXISTS operation_steps_operation_idx ON operation_steps(operation_id, position);

CREATE TABLE IF NOT EXISTS operation_events (
    id bigserial PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    step_id uuid REFERENCES operation_steps(id) ON DELETE CASCADE,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_events_operation_id_idx ON operation_events(operation_id, id);

CREATE TABLE IF NOT EXISTS token_usage (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    model_id uuid NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
    input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
    output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
    total_tokens bigint NOT NULL CHECK (total_tokens >= 0 AND total_tokens = input_tokens + output_tokens),
    period_start date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(operation_id),
    FOREIGN KEY (operation_id, workspace_id) REFERENCES operations(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (thread_id, workspace_id) REFERENCES chat_threads(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS token_usage_workspace_period_idx ON token_usage(workspace_id, period_start);
