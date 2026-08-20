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
	want := []string{"001_auth.sql", "002_catalog_servers.sql", "003_legacy_servers_health.sql", "004_legacy_audit_defaults.sql", "005_remove_dummy_catalog.sql", "006_ai_models_base_url.sql", "007_ai_model_api_keys.sql", "008_server_auth_methods.sql"}
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
