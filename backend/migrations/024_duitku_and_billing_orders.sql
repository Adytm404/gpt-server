CREATE TABLE IF NOT EXISTS platform_duitku_settings (
    id text PRIMARY KEY DEFAULT 'default',
    merchant_code text NOT NULL DEFAULT '',
    merchant_key_ciphertext bytea,
    environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    enabled boolean NOT NULL DEFAULT false,
    callback_url text NOT NULL DEFAULT '',
    return_url text NOT NULL DEFAULT '',
    expiry_period_minutes integer NOT NULL DEFAULT 60,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_orders (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_revision_id uuid NOT NULL REFERENCES subscription_plan_revisions(id) ON DELETE RESTRICT,
    merchant_order_id text UNIQUE NOT NULL,
    duitku_reference text NOT NULL DEFAULT '',
    billing_period text NOT NULL CHECK (billing_period IN ('monthly', 'annual')),
    amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
    payment_method text NOT NULL DEFAULT '',
    payment_url text NOT NULL DEFAULT '',
    paid_at timestamptz,
    raw_callback_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_orders_workspace_idx ON workspace_orders(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_orders_merchant_order_idx ON workspace_orders(merchant_order_id);
CREATE INDEX IF NOT EXISTS workspace_orders_reference_idx ON workspace_orders(duitku_reference);
