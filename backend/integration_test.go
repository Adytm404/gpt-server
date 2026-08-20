package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestIntegrationMigrationsAndServerCRUD(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("first migration: %v", err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("idempotent migration: %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	userID, workspaceID, serverID := uuid.New(), uuid.New(), uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO users(id,full_name,display_name,email,password_hash) VALUES($1,'Test User','Test User',$2,'test')`, userID, userID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspaces(id,name) VALUES($1,'Integration')`, workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, workspaceID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment) VALUES($1,$2,'API','127.0.0.1',22,'deploy','development')`, serverID, workspaceID); err != nil {
		t.Fatal(err)
	}
	var name string
	if err = tx.QueryRow(ctx, `UPDATE servers SET name='API 2' WHERE id=$1 AND workspace_id=$2 RETURNING name`, serverID, workspaceID).Scan(&name); err != nil || name != "API 2" {
		t.Fatalf("update: name=%q err=%v", name, err)
	}
	var otherWorkspaceCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM servers WHERE id=$1 AND workspace_id=$2`, serverID, uuid.New()).Scan(&otherWorkspaceCount); err != nil || otherWorkspaceCount != 0 {
		t.Fatalf("workspace isolation: count=%d err=%v", otherWorkspaceCount, err)
	}
	if _, err = tx.Exec(ctx, `UPDATE servers SET deleted_at=now() WHERE id=$1 AND workspace_id=$2`, serverID, workspaceID); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM servers WHERE id=$1 AND deleted_at IS NULL`, serverID).Scan(&visible); err != nil || visible != 0 {
		t.Fatalf("soft delete: count=%d err=%v", visible, err)
	}
}

func TestIntegrationDraftSlugAndPublishedModelDependency(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	modelID, planID, publishedID := uuid.New(), uuid.New(), uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO ai_models(id,external_model_id,name,provider,context_window) VALUES($1,$2,'Integration Model','test',1024)`, modelID, "integration-"+modelID.String()); err != nil {
		t.Fatal(err)
	}
	var defaultBaseURL string
	if err = tx.QueryRow(ctx, `SELECT base_url FROM ai_models WHERE id=$1`, modelID).Scan(&defaultBaseURL); err != nil || defaultBaseURL != "" {
		t.Fatalf("default base_url=%q err=%v", defaultBaseURL, err)
	}
	if err = tx.QueryRow(ctx, `UPDATE ai_models SET base_url=$2 WHERE id=$1 RETURNING base_url`, modelID, "http://localhost:11434/v1").Scan(&defaultBaseURL); err != nil || defaultBaseURL != "http://localhost:11434/v1" {
		t.Fatalf("persisted base_url=%q err=%v", defaultBaseURL, err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plans(id,slug) VALUES($1,$2)`, planID, "integration-"+planID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility) VALUES($1,$2,1,'Integration','integration','',0,0,'published',1,1,1000,100,100,'block_requests',$3,$3,'[]','private')`, publishedID, planID, modelID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO plan_allowed_models(revision_id,model_id) VALUES($1,$2)`, publishedID, modelID); err != nil {
		t.Fatal(err)
	}
	draftID := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility) SELECT $1,plan_id,revision+1,name,slug,description,price_cents,annual_price_cents,'draft',max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility FROM subscription_plan_revisions WHERE id=$2`, draftID, publishedID); err != nil {
		t.Fatalf("draft with same logical slug: %v", err)
	}
	var effectiveCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT DISTINCT ON (plan_id) id FROM subscription_plan_revisions WHERE plan_id=$1 AND status IN ('draft','published') ORDER BY plan_id,(status='draft') DESC) effective`, planID).Scan(&effectiveCount); err != nil || effectiveCount != 1 {
		t.Fatalf("effective plans count=%d err=%v", effectiveCount, err)
	}
	var used bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_plan_revisions p LEFT JOIN plan_allowed_models pam ON pam.revision_id=p.id WHERE p.status='published' AND (p.default_model_id=$1 OR p.fallback_model_id=$1 OR pam.model_id=$1))`, modelID).Scan(&used); err != nil || !used {
		t.Fatalf("published model dependency used=%v err=%v", used, err)
	}
}

func TestIntegrationChatTenantIsolationAndOperationState(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	userID, workspaceID, otherWorkspaceID, serverID, modelID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users(id,full_name,display_name,email,password_hash) VALUES($1,'Chat User','Chat User',$2,'test')`, []any{userID, userID.String() + "@chat.test"}},
		{`INSERT INTO workspaces(id,name) VALUES($1,'Chat Workspace'),($2,'Other Workspace')`, []any{workspaceID, otherWorkspaceID}},
		{`INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment) VALUES($1,$2,'API','127.0.0.1',22,'deploy','development')`, []any{serverID, workspaceID}},
		{`INSERT INTO ai_models(id,external_model_id,name,provider,base_url,context_window) VALUES($1,$2,'Chat Model','test','http://127.0.0.1',1024)`, []any{modelID, "chat-" + modelID.String()}},
		{`INSERT INTO workspace_subscriptions(workspace_id,default_model_id,monthly_token_limit) VALUES($1,$2,1000)`, []any{workspaceID, modelID}},
	} {
		if _, err = tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	threadID, operationID := uuid.New(), uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO chat_threads(id,workspace_id,server_id,created_by,title) VALUES($1,$2,$3,$4,'Diagnostics')`, threadID, workspaceID, serverID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO operations(id,thread_id,workspace_id,server_id,server_updated_at,created_by,model_id,status,policy,risk,title,summary) SELECT $1,$2,$3,$4,updated_at,$5,$6,'pending_approval','approval_required','low','Health','Check health' FROM servers WHERE id=$4`, operationID, threadID, workspaceID, serverID, userID, modelID); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM chat_threads WHERE id=$1 AND workspace_id=$2`, threadID, otherWorkspaceID).Scan(&visible); err != nil || visible != 0 {
		t.Fatalf("thread isolation count=%d err=%v", visible, err)
	}
	tag, err := tx.Exec(ctx, `UPDATE operations SET status='approved',approved_by=$3,approved_at=now() WHERE id=$1 AND workspace_id=$2 AND status='pending_approval'`, operationID, workspaceID, userID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("approve rows=%d err=%v", tag.RowsAffected(), err)
	}
	tag, err = tx.Exec(ctx, `UPDATE operations SET status='approved' WHERE id=$1 AND workspace_id=$2 AND status='pending_approval'`, operationID, workspaceID)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("double approve rows=%d err=%v", tag.RowsAffected(), err)
	}
	tag, err = tx.Exec(ctx, `UPDATE operations SET status='cancelled' WHERE id=$1 AND workspace_id=$2 AND status IN ('pending_approval','approved','running')`, operationID, otherWorkspaceID)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("cross-tenant cancel rows=%d err=%v", tag.RowsAffected(), err)
	}
}

func TestIntegrationFailPlanningIgnoresCancelledRequestContext(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	userID, workspaceID, serverID, modelID, threadID, operationID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users(id,full_name,display_name,email,password_hash) VALUES($1,'Cancelled User','Cancelled User',$2,'test')`, []any{userID, userID.String() + "@cancelled.test"}},
		{`INSERT INTO workspaces(id,name) VALUES($1,'Cancelled Workspace')`, []any{workspaceID}},
		{`INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment) VALUES($1,$2,'API','127.0.0.1',22,'deploy','development')`, []any{serverID, workspaceID}},
		{`INSERT INTO ai_models(id,external_model_id,name,provider,base_url,context_window) VALUES($1,$2,'Chat Model','test','http://127.0.0.1',1024)`, []any{modelID, "cancelled-" + modelID.String()}},
		{`INSERT INTO chat_threads(id,workspace_id,server_id,created_by,title) VALUES($1,$2,$3,$4,'Diagnostics')`, []any{threadID, workspaceID, serverID, userID}},
		{`INSERT INTO operations(id,thread_id,workspace_id,server_id,server_updated_at,created_by,model_id,status,policy) SELECT $1,$2,$3,$4,updated_at,$5,$6,'planning','approval_required' FROM servers WHERE id=$4`, []any{operationID, threadID, workspaceID, serverID, userID, modelID}},
	}
	for _, statement := range statements {
		if _, err = tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	s := &server{db: db}
	cancelled, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()
	if cancelled.Err() == nil {
		t.Fatal("test request context was not cancelled")
	}
	s.failPlanning(operationID, "provider request cancelled")
	active, err := s.hasActiveOperation(context.Background(), threadID, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Fatal("cancelled planning operation retained active lock")
	}
}
