package main

import (
	"io/fs"
	"reflect"
	"strings"
	"testing"
)

func TestEmbeddedMigrationOrderAndLegacyServerRepair(t *testing.T) {
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	want := []string{"001_auth.sql", "002_catalog_servers.sql", "003_legacy_servers_health.sql", "004_legacy_audit_defaults.sql", "005_remove_dummy_catalog.sql", "006_ai_models_base_url.sql", "007_ai_model_api_keys.sql", "008_server_auth_methods.sql", "009_server_inventory.sql", "010_chat_operations.sql", "011_one_active_operation_per_thread.sql", "012_operation_summaries.sql", "013_llm_intent_routing.sql", "014_chat_message_kind.sql", "015_chat_message_operation.sql", "016_chat_message_sequence.sql", "017_agent_iterations.sql", "018_unrestricted_operations.sql", "019_autonomous_full_access.sql", "020_workspace_and_user_settings.sql", "021_google_oauth_settings.sql"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("migration order = %v, want %v", names, want)
	}

	sql, err := migrationFiles.ReadFile("migrations/003_legacy_servers_health.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(sql)
	for _, clause := range []string{
		"encrypted_private_key DROP NOT NULL",
		"metadata SET DEFAULT '{}'::jsonb",
		"SET ssh_user = username",
		"username DROP NOT NULL",
		"ADD COLUMN IF NOT EXISTS disk_percent",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("003 migration missing %q", clause)
		}
	}
	if strings.Contains(strings.ToUpper(content), "DROP TABLE") {
		t.Fatal("003 migration must not drop tables")
	}
	if strings.Contains(content, "legacy_column") || strings.Contains(content, "information_schema.columns\n        WHERE") && strings.Contains(content, "column_name NOT IN") {
		t.Fatal("003 migration must not relax unknown columns")
	}
}

func TestChatMessageSequenceMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/016_chat_message_sequence.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"CREATE SEQUENCE IF NOT EXISTS chat_message_global_sequence",
		"ADD COLUMN IF NOT EXISTS sequence bigint",
		"row_number() OVER",
		"EXISTS (SELECT 1 FROM chat_messages WHERE sequence IS NULL)",
		"ORDER BY created_at",
		"WHEN role = 'user' THEN 0",
		"WHEN role = 'assistant' THEN 1",
		"WHEN kind = 'chat' THEN 0",
		"WHEN kind = 'plan' THEN 1",
		"id",
		"ALTER COLUMN sequence SET NOT NULL",
		"ALTER COLUMN sequence SET DEFAULT nextval('chat_message_global_sequence')",
		"setval('chat_message_global_sequence'",
		"CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_sequence_idx ON chat_messages(sequence)",
		"CREATE INDEX IF NOT EXISTS chat_messages_thread_sequence_idx ON chat_messages(thread_id, sequence)",
		"ADD COLUMN IF NOT EXISTS reply_to_message_id uuid",
		"FOREIGN KEY (reply_to_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL",
		"candidate.operation_id = assistant.operation_id",
		"candidate.sequence < assistant.sequence",
		"ORDER BY candidate.sequence DESC",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("016 migration missing %q", clause)
		}
	}
	createSequence := strings.Index(content, "CREATE SEQUENCE IF NOT EXISTS")
	addSequence := strings.Index(content, "ADD COLUMN IF NOT EXISTS sequence bigint")
	backfill := strings.Index(content, "row_number() OVER")
	notNull := strings.Index(content, "ALTER COLUMN sequence SET NOT NULL")
	defaultValue := strings.Index(content, "ALTER COLUMN sequence SET DEFAULT")
	setval := strings.Index(content, "setval('chat_message_global_sequence'")
	if createSequence < 0 || addSequence < createSequence || backfill < addSequence || notNull < backfill || defaultValue < notNull || setval < defaultValue {
		t.Fatal("016 must create sequence, add/backfill column, constrain it, set default, then advance sequence")
	}
}

func TestChatMessageOperationMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/015_chat_message_operation.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS operation_id uuid",
		"DROP CONSTRAINT IF EXISTS chat_messages_operation_id_fkey",
		"FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL",
		"FROM token_usage tu",
		"tu.message_id = cm.id",
		"tu.operation_id IS NOT NULL",
		"tu.phase IN ('planning','summary')",
		"FROM operation_events e",
		"e.event_type = 'planning'",
		"(e.payload->>'message_id')::uuid = cm.id",
		"CREATE INDEX IF NOT EXISTS chat_messages_thread_operation_created_idx ON chat_messages(thread_id, operation_id, created_at)",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("015 migration missing %q", clause)
		}
	}
	addColumn := strings.Index(content, "ADD COLUMN IF NOT EXISTS operation_id uuid")
	backfill := strings.Index(content, "UPDATE chat_messages cm")
	foreignKey := strings.Index(content, "FOREIGN KEY (operation_id)")
	if addColumn < 0 || backfill < addColumn || foreignKey < backfill {
		t.Fatal("015 must add column, backfill, then add foreign key")
	}
}

func TestChatMessageKindMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/014_chat_message_kind.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat'",
		"DROP CONSTRAINT IF EXISTS chat_messages_kind_check",
		"kind IN ('chat','plan','result')",
		"WHEN role IN ('user','system') THEN 'chat'",
		"tu.phase = 'planning'",
		"THEN 'plan'",
		"tu.phase = 'summary'",
		"THEN 'result'",
		"ELSE 'chat'",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("014 migration missing %q", clause)
		}
	}
	if strings.Index(content, "UPDATE chat_messages") > strings.Index(content, "ADD CONSTRAINT chat_messages_kind_check") {
		t.Fatal("014 must backfill before adding kind constraint")
	}
}

func TestLLMIntentRoutingMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/013_llm_intent_routing.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"response_language text NOT NULL DEFAULT 'en'", "'routing'", "DROP INDEX IF EXISTS token_usage_message_id_idx", "token_usage_message_phase_idx", "ON token_usage(message_id, phase)"} {
		if !strings.Contains(content, clause) {
			t.Errorf("013 migration missing %q", clause)
		}
	}
	if strings.Contains(content, "INSERT INTO") {
		t.Fatal("013 migration contains seeds")
	}
}

func TestAgentIterationsMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/017_agent_iterations.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"'agent'", "round integer NOT NULL DEFAULT 0", "CHECK (round >= 0)", "agent_round integer NOT NULL DEFAULT 0", "CHECK (agent_round >= 0)", "DROP INDEX IF EXISTS token_usage_operation_phase_idx", "ON token_usage(operation_id, phase, round)"} {
		if !strings.Contains(content, clause) {
			t.Errorf("017 migration missing %q", clause)
		}
	}
	if strings.Contains(content, "INSERT INTO") {
		t.Fatal("017 migration contains seeds")
	}
}

func TestUnrestrictedOperationsMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/018_unrestricted_operations.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"DROP CONSTRAINT IF EXISTS operations_policy_check", "'unrestricted_approval'", "DROP CONSTRAINT IF EXISTS operations_risk_check", "'high'"} {
		if !strings.Contains(content, clause) {
			t.Errorf("018 migration missing %q", clause)
		}
	}
	if strings.Contains(content, "INSERT INTO") {
		t.Fatal("018 migration contains seeds")
	}
}

func TestAutonomousFullAccessMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/019_autonomous_full_access.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"'autonomous_full_access'", "DROP CONSTRAINT IF EXISTS operations_policy_check", "DROP CONSTRAINT IF EXISTS operations_risk_check"} {
		if !strings.Contains(content, clause) {
			t.Errorf("019 migration missing %q", clause)
		}
	}
}

func TestOperationSummariesMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/012_operation_summaries.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"DROP CONSTRAINT IF EXISTS operations_status_check", "'summarizing'", "ALTER COLUMN operation_id DROP NOT NULL", "phase text NOT NULL DEFAULT 'planning'", "phase IN ('planning','summary','explain')", "message_id uuid REFERENCES chat_messages", "DROP CONSTRAINT IF EXISTS token_usage_operation_id_key", "token_usage_operation_phase_idx", "token_usage_message_id_idx"} {
		if !strings.Contains(content, clause) {
			t.Errorf("012 migration missing %q", clause)
		}
	}
	for _, forbidden := range []string{"INSERT INTO chat_messages", "INSERT INTO token_usage"} {
		if strings.Contains(content, forbidden) {
			t.Errorf("012 migration contains seed %q", forbidden)
		}
	}
}

func TestChatOperationsMigrationHasIsolationConstraintsAndNoSeeds(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/010_chat_operations.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{"workspace_id uuid PRIMARY KEY", "monthly_token_limit bigint NOT NULL DEFAULT 0", "CREATE TABLE IF NOT EXISTS chat_threads", "CREATE TABLE IF NOT EXISTS chat_messages", "CREATE TABLE IF NOT EXISTS operations", "server_updated_at timestamptz NOT NULL", "CREATE TABLE IF NOT EXISTS operation_steps", "CREATE TABLE IF NOT EXISTS operation_events", "CREATE TABLE IF NOT EXISTS token_usage", "UNIQUE(operation_id, position)", "UNIQUE(operation_id)", "UNIQUE(id, workspace_id)", "FOREIGN KEY (server_id, workspace_id)", "FOREIGN KEY (thread_id, workspace_id)", "FOREIGN KEY (operation_id, workspace_id)", "total_tokens = input_tokens + output_tokens"} {
		if !strings.Contains(content, clause) {
			t.Errorf("010 migration missing %q", clause)
		}
	}
	for _, forbidden := range []string{"INSERT INTO workspace_subscriptions", "INSERT INTO chat_threads", "INSERT INTO chat_messages", "api.openai.com"} {
		if strings.Contains(content, forbidden) {
			t.Errorf("010 migration contains seed/fallback %q", forbidden)
		}
	}
}

func TestChatMigrationOnlyRebuildsEmptyLegacyOperations(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/010_chat_operations.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"incompatible legacy operation tables contain data; manual migration required",
		"operation_count <> 0 OR step_count <> 0 OR event_count <> 0",
		"column_name='thread_id'",
	} {
		if !strings.Contains(content, clause) {
			t.Fatalf("legacy operation migration guard missing %q", clause)
		}
	}
}

func TestActiveOperationMigrationRepairsDuplicatesBeforeIndex(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/011_one_active_operation_per_thread.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	cleanup := strings.Index(content, "row_number() OVER")
	index := strings.Index(content, "CREATE UNIQUE INDEX")
	if cleanup < 0 || index < 0 || cleanup > index || !strings.Contains(content, "status='failed'") {
		t.Fatalf("011 does not safely close duplicates before index: %s", content)
	}
}

func TestServerInventoryMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/009_server_inventory.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS operating_system text NOT NULL DEFAULT ''",
		"ADD COLUMN IF NOT EXISTS uptime_seconds bigint",
		"ADD COLUMN IF NOT EXISTS disk_percent",
		"ADD COLUMN IF NOT EXISTS services jsonb NOT NULL DEFAULT '[]'::jsonb",
		"ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb",
		"UPDATE servers SET operating_system = '' WHERE operating_system IS NULL",
		"ALTER COLUMN operating_system SET NOT NULL",
		"UPDATE server_health_snapshots SET services = '[]'::jsonb WHERE services IS NULL",
		"ALTER COLUMN details SET NOT NULL",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("009 migration missing %q", clause)
		}
	}
}

func TestServerAuthMethodMigration(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/008_server_auth_methods.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'ssh_key'",
		"auth_method IN ('ssh_key','password')",
		"ADD COLUMN IF NOT EXISTS password_ciphertext bytea",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("008 migration missing %q", clause)
		}
	}
	if strings.Contains(content, "password_ciphertext bytea NOT NULL") {
		t.Fatal("008 migration makes password ciphertext non-nullable")
	}
}

func TestModelAPIKeyMigrationAddsNullableCiphertext(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/007_ai_model_api_keys.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	if !strings.Contains(content, "ADD COLUMN IF NOT EXISTS api_key_ciphertext bytea") {
		t.Fatalf("007 migration missing API key ciphertext column: %s", content)
	}
	if strings.Contains(content, "SET NOT NULL") {
		t.Fatal("007 migration makes ciphertext non-nullable")
	}
}

func TestModelBaseURLMigrationBackfillsWithoutFakeEndpoint(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/006_ai_models_base_url.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ADD COLUMN base_url text",
		"UPDATE ai_models SET base_url = '' WHERE base_url IS NULL",
		"ALTER COLUMN base_url SET DEFAULT ''",
		"ALTER COLUMN base_url SET NOT NULL",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("006 migration missing %q", clause)
		}
	}
	for _, forbidden := range []string{"api.openai.com", "localhost", "example.com"} {
		if strings.Contains(content, forbidden) {
			t.Errorf("006 migration contains fake endpoint %q", forbidden)
		}
	}
}

func TestCatalogMigrationUsesCanonicalPlanSlugWithoutSeeds(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/002_catalog_servers.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"subscription_plans ADD COLUMN IF NOT EXISTS slug",
		"subscription_plans_slug_idx",
		"DROP INDEX IF EXISTS plan_live_slug_idx",
		"ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS credential_configured",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("002 migration missing %q", clause)
		}
	}
	for _, forbidden := range []string{
		"Claude 4 Sonnet",
		"GPT-5 mini",
		"Gemini 2.5 Flash",
		"Llama 3.3 70B",
		"10000000-0000-4000-8000-000000000001",
		"INSERT INTO ai_models",
		"INSERT INTO subscription_plans",
		"INSERT INTO subscription_plan_revisions",
		"INSERT INTO plan_allowed_models",
	} {
		if strings.Contains(content, forbidden) {
			t.Errorf("002 migration retains catalog seed %q", forbidden)
		}
	}
}

func TestDummyCatalogCleanupUsesOnlyExactSeedIDs(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/005_remove_dummy_catalog.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, id := range []string{
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
		"10000000-0000-4000-8000-000000000003",
		"10000000-0000-4000-8000-000000000004",
		"20000000-0000-4000-8000-000000000001",
		"20000000-0000-4000-8000-000000000002",
		"30000000-0000-4000-8000-000000000001",
		"30000000-0000-4000-8000-000000000002",
	} {
		if !strings.Contains(content, id) {
			t.Errorf("005 migration missing seed ID %s", id)
		}
	}
	for _, forbidden := range []string{"external_model_id=", "external_model_id =", "name=", "name =", "slug=", "slug =", "ILIKE"} {
		if strings.Contains(content, forbidden) {
			t.Errorf("005 migration uses broad catalog match %q", forbidden)
		}
	}
	for _, clause := range []string{"DELETE FROM plan_allowed_models", "DELETE FROM subscription_plan_revisions", "DELETE FROM subscription_plans", "DELETE FROM audit_events", "RAISE EXCEPTION"} {
		if !strings.Contains(content, clause) {
			t.Errorf("005 migration missing %q", clause)
		}
	}
}

func TestCatalogMigrationRepairsLegacyAuditAndHealthTables(t *testing.T) {
	raw, err := migrationFiles.ReadFile("migrations/002_catalog_servers.sql")
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, clause := range []string{
		"ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_type",
		"ALTER TABLE audit_events ALTER COLUMN workspace_id DROP NOT NULL",
		"ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS cpu_percent",
		"ALTER TABLE server_health_snapshots ADD COLUMN IF NOT EXISTS memory_percent",
	} {
		if !strings.Contains(content, clause) {
			t.Errorf("002 migration missing %q", clause)
		}
	}
}
