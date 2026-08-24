import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  LayoutGrid,
  ListFilter,
  LockKeyhole,
  MemoryStick,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  serversApi,
  formatBytes,
  type CreateServerDTO,
  type Server,
  type ServerSummaryDTO,
  type UpdateServerDTO,
} from "../api/servers";
import { useDialog } from "../ui/DialogProvider";

const cn = (...values: Array<string | false | undefined>) =>
  values.filter(Boolean).join(" ");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

function ApiState({
  loading,
  error,
  retry,
  empty,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  empty?: string;
}) {
  return loading ? (
    <div className="server-api-state">
      <span className="tiny-spinner" /> Loading servers...
    </div>
  ) : error ? (
    <div className="server-api-state error" role="alert">
      <span>{error}</span>
      <button className="button secondary" onClick={retry}>
        Retry
      </button>
    </div>
  ) : empty ? (
    <div className="server-api-state">{empty}</div>
  ) : null;
}
function StatusPill({ status }: { status: Server["status"] }) {
  return (
    <span className={cn("status-pill", status.toLowerCase())}>
      <i />
      {status}
    </span>
  );
}
function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="metric-bar">
      <small>{label}</small>
      <i>
        <b style={{ width: `${value}%` }} />
      </i>
      <em>{value}%</em>
    </span>
  );
}
function MiniStat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ServerIcon;
}) {
  return (
    <div className="mini-stat">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <i>
        <Icon size={18} />
      </i>
    </div>
  );
}

export function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [summary, setSummary] = useState<ServerSummaryDTO>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [grid, setGrid] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{ completed: number; total: number } | null>(null);
  const [editing, setEditing] = useState<Server | null>(null);

  const checkAllHealth = async () => {
    if (checkingAll || servers.length === 0) return;
    setCheckingAll(true);
    setError("");
    setCheckProgress({ completed: 0, total: servers.length });
    try {
      let done = 0;
      await Promise.all(
        servers.map(async (server) => {
          try {
            await serversApi.healthCheck(server.id);
          } catch {
            // Ignore single failure to allow all servers to complete
          } finally {
            done++;
            setCheckProgress({ completed: done, total: servers.length });
          }
        })
      );
      const result = await serversApi.list();
      setServers(result.servers);
      setSummary(result.summary);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setCheckingAll(false);
      setCheckProgress(null);
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await serversApi.list();
      setServers(result.servers);
      setSummary(result.summary);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = servers.filter(
    (server) =>
      `${server.name} ${server.host}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (statusFilter === "All" || server.status === statusFilter),
  );
  const connected =
    summary?.online ??
    servers.filter((server) => server.status === "Online").length;
  const healthy =
    summary?.online ??
    servers.filter((server) => server.status === "Online").length;
  const avgCpu = servers.length
    ? Math.round(
        servers.reduce(
          (sum, server) => sum + (server.latestSnapshot?.cpuPercent || 0),
          0,
        ) / servers.length,
      )
    : 0;
  return (
    <div className="content-page page-enter">
      <div className="page-heading">
        <div>
          <span className="page-eyebrow">Infrastructure</span>
          <h1>Servers</h1>
          <p>Connected machines, health signals, and access controls.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="button secondary"
            disabled={checkingAll || loading || servers.length === 0}
            onClick={() => void checkAllHealth()}
            title="Run health check on all servers"
          >
            <RefreshCw size={15} className={cn(checkingAll && "spin-animation")} />
            {checkingAll && checkProgress
              ? `Checking (${checkProgress.completed}/${checkProgress.total})...`
              : "Check all health"}
          </button>
          <button className="button dark" onClick={() => setShowAdd(true)}>
            <Plus size={17} /> Add server
          </button>
        </div>
      </div>
      <div className="stats-strip">
        <MiniStat
          label="Connected"
          value={String(connected)}
          detail={`of ${summary?.total ?? servers.length} servers`}
          icon={ServerIcon}
        />
        <MiniStat
          label="Online"
          value={String(healthy)}
          detail={`${summary?.offline ?? servers.filter((x) => x.status === "Offline").length} offline`}
          icon={CheckCircle2}
        />
        <MiniStat
          label="Avg. CPU"
          value={`${avgCpu}%`}
          detail="latest snapshots"
          icon={Cpu}
        />
        <MiniStat
          label="Unknown"
          value={String(
            summary?.unknown ??
              servers.filter((x) => x.status === "Unknown").length,
          )}
          detail="awaiting check"
          icon={Activity}
        />
      </div>
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder="Search server or host..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filter-control">
          <button
            className={cn(
              "button secondary",
              statusFilter !== "All" && "active",
            )}
            onClick={() => setFilterOpen((x) => !x)}
          >
            <ListFilter size={16} />{" "}
            {statusFilter === "All" ? "Filter" : statusFilter}
          </button>
          {filterOpen && (
            <div className="filter-popover">
              {["All", "Online", "Offline", "Unknown"].map((item) => (
                <button
                  className={statusFilter === item ? "active" : ""}
                  key={item}
                  onClick={() => {
                    setStatusFilter(item);
                    setFilterOpen(false);
                  }}
                >
                  {item}
                  {statusFilter === item && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={cn("icon-button bordered", grid && "active")}
          onClick={() => setGrid((x) => !x)}
          aria-label="Toggle server layout"
        >
          <LayoutGrid size={17} />
        </button>
      </div>
      <ApiState
        loading={loading}
        error={error}
        retry={() => void load()}
        empty={
          !servers.length
            ? "No servers connected."
            : filtered.length === 0
              ? "No servers match filters."
              : undefined
        }
      />
      {!loading && !error && filtered.length > 0 && (
        <div className={cn("server-list", grid && "grid-view")}>
          <div className="server-list-head">
            <span>Server</span>
            <span>Environment</span>
            <span>Resources</span>
            <span>Status</span>
            <span />
          </div>
          {filtered.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}
      {showAdd && (
        <AddServerModal
          close={() => setShowAdd(false)}
          created={() => void load()}
          saved={() => setShowAdd(false)}
        />
      )}
      {editing && (
        <EditServerModal
          server={editing}
          close={() => setEditing(null)}
          saved={() => void load()}
        />
      )}
    </div>
  );
}

function ServerRow({
  server,
  onEdit,
}: {
  server: Server;
  onEdit: (server: Server) => void;
}) {
  const navigate = useNavigate();
  const snapshot = server.latestSnapshot;
  return (
    <button
      className="server-row"
      onClick={() => navigate(`/dashboard/servers/${server.id}`)}
    >
      <span className="server-identity">
        <i className={cn("server-glyph", server.status.toLowerCase())}>
          <ServerIcon size={18} />
        </i>
        <span>
          <strong>{server.name}</strong>
          <small>
            {server.host} / {server.region}
          </small>
        </span>
      </span>
      <span>
        <b className={cn("env-tag", server.environment.toLowerCase())}>
          {server.environment}
        </b>
      </span>
      <span className="resource-bars">
        {snapshot ? (
          <>
            <MetricBar label="CPU" value={snapshot.cpuPercent} />
            <MetricBar label="MEM" value={snapshot.memoryPercent} />
          </>
        ) : (
          <small>No snapshot</small>
        )}
      </span>
      <StatusPill status={server.status} />
      <ArrowRight size={17} />
    </button>
  );
}

function EditServerModal({
  server,
  close,
  saved,
}: {
  server: Server;
  close: () => void;
  saved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<UpdateServerDTO>({
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_method: server.authMethod,
    host_fingerprint: server.fingerprint || "",
    environment: server.environment.toLowerCase(),
    region: server.region === "-" ? "" : server.region,
  });
  const update = (patch: Partial<UpdateServerDTO>) =>
    setForm((current) => ({ ...current, ...patch }));
  const ready = Boolean(
    form.name?.trim() &&
      form.host?.trim() &&
      form.username?.trim() &&
      form.port &&
      (!form.private_key || !form.password),
  );
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await serversApi.update(server.id, form);
      saved();
      close();
    } catch (caught) {
      setError(message(caught));
      setSaving(false);
    }
  };
  return createPortal(
    <div className="modal-layer">
      <button className="modal-scrim" onClick={close} aria-label="Close" />
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <span className="page-eyebrow">Server settings</span>
            <h2>Edit server</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <Field
              label="Server name"
              value={form.name || ""}
              update={(name) => update({ name })}
            />
            <Field
              label="Hostname or IP"
              value={form.host || ""}
              update={(host) => update({ host })}
            />
            <Field
              label="SSH port"
              value={String(form.port ?? "")}
              update={(port) => update({ port: Number(port) })}
            />
            <label className="field">
              <span>Environment</span>
              <select
                value={form.environment}
                onChange={(e) => update({ environment: e.target.value })}
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </label>
            <Field
              label="SSH username"
              value={form.username || ""}
              update={(username) => update({ username })}
            />
            <Field
              label="Region / location (optional)"
              value={form.region || ""}
              update={(region) => update({ region })}
            />
            <Field
              full
              label="Host fingerprint (optional)"
              value={form.host_fingerprint || ""}
              update={(host_fingerprint) => update({ host_fingerprint })}
            />
            <div className="auth-method full">
              <span className="auth-method-label">Authentication method</span>
              <div
                className="auth-tabs"
                role="tablist"
                aria-label="Authentication method"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={form.auth_method === "ssh_key"}
                  onClick={() =>
                    update({ auth_method: "ssh_key", password: undefined })
                  }
                >
                  <KeyRound size={16} /> SSH key
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={form.auth_method === "password"}
                  onClick={() =>
                    update({ auth_method: "password", private_key: undefined })
                  }
                >
                  <LockKeyhole size={16} /> Password
                </button>
              </div>
            </div>
            {form.auth_method === "ssh_key" ? (
              <label className="field full" role="tabpanel">
                <span>Replace private key</span>
                <textarea
                  rows={5}
                  value={form.private_key || ""}
                  onChange={(e) => update({ private_key: e.target.value })}
                  placeholder="Leave empty to keep the stored key. Paste a new key to replace it."
                />
              </label>
            ) : (
              <label className="field full" role="tabpanel">
                <span>Replace SSH password</span>
                <span className="password-control">
                  <input
                    value={form.password || ""}
                    onChange={(e) => update({ password: e.target.value })}
                    type={showPassword ? "text" : "password"}
                    placeholder="Leave empty to keep the stored password."
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
            )}
          </div>
          <p className="edit-server-note">
            Changing hostname, port, username, auth method, or credentials resets
            server status to Unknown until the next health check.
          </p>
          {error && (
            <div className="server-modal-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="button dark"
            disabled={saving || !ready}
            onClick={() => void submit()}
          >
            {saving ? "Saving..." : "Save changes"} <Check size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AddServerModal({
  close,
  created: persisted,
  saved,
}: {
  close: () => void;
  created: () => void;
  saved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Server | null>(null);
  const [testResult, setTestResult] = useState<{ authMethod?: "ssh_key" | "password"; latencyMs?: number } | null>(null);
  const [form, setForm] = useState<CreateServerDTO>({
    name: "",
    host: "",
    port: 22,
    username: "root",
    auth_method: "ssh_key",
    private_key: "",
    host_fingerprint: "",
    environment: "production",
  });
  const ready = Boolean(
    form.name.trim() &&
    form.host.trim() &&
    form.username.trim() &&
    form.port &&
    (form.auth_method === "ssh_key" ? form.private_key : form.password),
  );
  const testAndCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await serversApi.testDraft(form);
      if (!result.ok) throw new Error(result.message || "SSH connection failed");
      setTestResult({ ...result, authMethod: result.authMethod || form.auth_method });
      setStep(2);
      const serverPayload = {
        ...form,
        host_fingerprint: form.host_fingerprint || result.hostFingerprint || "",
      };
      const server = await serversApi.create(serverPayload);
      setCreated(server);
      persisted();
      setForm((current) => ({ ...current, private_key: "", password: "" }));
      setStep(3);
    } catch (caught) {
      setStep(1);
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  };
  const changeAuthMethod = (auth_method: CreateServerDTO["auth_method"]) => {
    setError("");
    setShowPassword(false);
    setForm((current) => ({ ...current, auth_method, private_key: auth_method === "password" ? "" : current.private_key, password: auth_method === "ssh_key" ? "" : current.password }));
  };
  const dismiss = () => {
    setForm((current) => ({ ...current, private_key: "", password: "" }));
    close();
  };
  return createPortal(
    <div className="modal-layer">
      <button className="modal-scrim" onClick={dismiss} aria-label="Close" />
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <span className="page-eyebrow">Secure connection</span>
            <h2>Add a server</h2>
          </div>
          <button className="icon-button" onClick={dismiss} aria-label="Close dialog">
            <X size={19} />
          </button>
        </div>
        <div className="stepper">
          {["Details", "Verified", "Saved"].map(
            (label, index) => (
              <div
                className={cn("step", step >= index + 1 && "active")}
                key={label}
              >
                <i>{step > index + 1 ? <Check size={13} /> : index + 1}</i>
                <span>{label}</span>
              </div>
            ),
          )}
        </div>
        <div className="modal-body">
          {step === 1 && (
            <div className="form-grid">
              <Field
                label="Server name"
                value={form.name}
                update={(name) => setForm({ ...form, name })}
              />
              <Field
                label="Hostname or IP"
                value={form.host}
                update={(host) => setForm({ ...form, host })}
              />
              <Field
                label="SSH port"
                value={String(form.port)}
                update={(port) => setForm({ ...form, port: Number(port) })}
              />
              <label className="field">
                <span>Environment</span>
                <select
                  value={form.environment}
                  onChange={(e) =>
                    setForm({ ...form, environment: e.target.value })
                  }
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                </select>
              </label>
              <Field
                label="SSH username"
                value={form.username}
                update={(username) => setForm({ ...form, username })}
              />
              <Field
                label="Region (optional)"
                value={form.region || ""}
                update={(region) => setForm({ ...form, region })}
              />
              <div className="auth-method full">
                <span className="auth-method-label">Authentication method</span>
                <div className="auth-tabs" role="tablist" aria-label="Authentication method">
                  <button type="button" role="tab" aria-selected={form.auth_method === "ssh_key"} onClick={() => changeAuthMethod("ssh_key")}><KeyRound size={16} /> SSH key</button>
                  <button type="button" role="tab" aria-selected={form.auth_method === "password"} onClick={() => changeAuthMethod("password")}><LockKeyhole size={16} /> Password</button>
                </div>
              </div>
              {form.auth_method === "ssh_key" ? (
                <label className="field full" role="tabpanel">
                  <span>Private key</span>
                  <textarea className="key-input" required rows={5} value={form.private_key || ""} onChange={(e) => setForm({ ...form, private_key: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                </label>
              ) : (
                <label className="field full" role="tabpanel">
                  <span>SSH password</span>
                  <span className="password-control">
                    <input required value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} type={showPassword ? "text" : "password"} />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </span>
                </label>
              )}
              <Field
                full
                label="Expected host fingerprint (optional)"
                value={form.host_fingerprint || ""}
                update={(host_fingerprint) =>
                  setForm({ ...form, host_fingerprint })
                }
              />
              <div className="security-note full">
                <ShieldCheck size={18} />
                <span>
                  <strong>{form.auth_method === "ssh_key" ? "Encrypted key storage" : "One-time password entry"}</strong>
                  {form.auth_method === "ssh_key" ? "Backend encrypts the private key. When supplied, host fingerprint matching is strict." : "Password is sent to backend, encrypted at rest, and never displayed again. A supplied fingerprint is matched strictly."}
                </span>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="connection-result">
              <div className="success-seal">
                <KeyRound size={25} />
              </div>
              <h3>SSH access verified</h3>
              <p>Credential accepted. Saving server now.</p>
              <div className="check-list">
                <span>
                  <Check size={15} /> SSH authentication succeeded
                </span>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="connection-result">
              <div className="success-seal">
                <Check size={26} />
              </div>
              <h3>Server saved</h3>
              <p>{testResult?.authMethod === "password" ? "Password" : "SSH key"} authentication verified{typeof testResult?.latencyMs === "number" ? ` in ${testResult.latencyMs} ms` : ""}. Credential cleared from this form.</p>
            </div>
          )}
          {error && (
            <div className="server-modal-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button secondary" onClick={dismiss}>
            Cancel
          </button>
          <button
            className="button dark"
            disabled={saving || (step === 1 && !ready)}
            onClick={() =>
              step === 1
                ? void testAndCreate()
                : created && saved()
            }
          >
            {saving
              ? "Working..."
              : step === 1
                ? "Test & add server"
                : "Finish"}{" "}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
function Field({
  label,
  value,
  update,
  type = "text",
  full = false,
}: {
  label: string;
  value: string;
  update: (value: string) => void;
  type?: string;
  full?: boolean;
}) {
  return (
    <label className={cn("field", full && "full")}>
      <span>{label}</span>
      <input
        required
        value={value}
        onChange={(e) => update(e.target.value)}
        type={type}
      />
    </label>
  );
}

export function ServerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const dialog = useDialog();
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [tab, setTab] = useState("Overview");
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setServer(await serversApi.get(id));
    } catch (caught) {
      setLoadError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const test = async () => {
    setTesting(true);
    setActionMessage("");
    setActionError("");
    try {
      const result = await serversApi.testConnection(id);
      if (result.ok) {
        setActionMessage(result.message || "Connection successful");
        setServer(await serversApi.get(id));
      } else setActionError(result.message || "Connection failed");
    } catch (caught) {
      setActionError(message(caught));
    } finally {
      setTesting(false);
    }
  };
  const check = async () => {
    setChecking(true);
    setActionMessage("");
    setActionError("");
    try {
      setServer(await serversApi.healthCheck(id));
      setActionMessage("Health check completed");
    } catch (caught) {
      setActionError(message(caught));
    } finally {
      setChecking(false);
    }
  };
  const remove = async () => {
    if (deleting || !server) return;
    setDeleting(true);
    if (!await dialog.confirm({ title: "Delete server?", description: `${server.name} will be removed from this workspace. Existing operation history remains available.`, confirmLabel: "Delete server", tone: "destructive" })) { setDeleting(false); return; }
    setActionError("");
    try {
      await serversApi.remove(id);
      navigate("/dashboard/servers", { replace: true });
    } catch (caught) {
      const description = message(caught);
      setActionError(description);
      setDeleting(false);
      await dialog.notice({ title: "Unable to delete server", description, tone: "destructive" });
    }
  };
  if (loading || loadError || !server)
    return (
      <div className="content-page">
        <ApiState
          loading={loading}
          error={loadError || (!server ? "Server not found" : "")}
          retry={() => void load()}
        />
      </div>
    );
  const snapshot = server.latestSnapshot;
  return (
    <div className="content-page server-detail-page page-enter">
      <button className="back-link" onClick={() => navigate("/dashboard/servers")}>
        <ArrowLeft size={15} /> All servers
      </button>
      <section className="server-overview-card">
        <div className="server-detail-head">
          <div className="server-title">
            <i className={cn("server-glyph", server.status.toLowerCase())}>
              <ServerIcon size={22} />
            </i>
            <div>
              <div className="title-line">
                <h1>{server.name}</h1>
                <StatusPill status={server.status} />
              </div>
              <p>
                {server.host}:{server.port}
              </p>
            </div>
          </div>
          <div className="heading-actions">
            <button
              className="button secondary"
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} /> Edit
            </button>
            <button
              className="button secondary"
              disabled={testing}
              onClick={() => void test()}
            >
              {testing ? "Testing..." : "Test SSH connection"}
            </button>
            <button
              className="button secondary danger-button"
              disabled={deleting}
              onClick={() => void remove()}
            >
              <Trash2 size={15} /> {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        <div className="server-facts">
          <div>
            <span>Environment</span>
            <b className={cn("env-tag", server.environment.toLowerCase())}>
              {server.environment}
            </b>
          </div>
          <div>
            <span>Region</span>
            <b>{server.region}</b>
          </div>
          <div>
            <span>Operating system</span>
            <b>{server.operatingSystem}</b>
          </div>
          <div>
            <span>Uptime</span>
            <b>{server.uptime}</b>
          </div>
          <div>
            <span>Authentication</span>
            <b>{server.authMethod === "password" ? "Password" : "SSH key"}</b>
          </div>
          <div>
            <span>SSH access</span>
            <b className="verified-access">
              <ShieldCheck size={13} />{" "}
              {server.fingerprint ? "Fingerprint stored" : "Not reported"}
            </b>
          </div>
        </div>
      </section>
      {actionError && (
        <div className="server-modal-error" role="alert">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="health-banner">
          <div>
            <CheckCircle2 size={17} />
            <strong>{actionMessage}</strong>
          </div>
        </div>
      )}
      {editing && (
        <EditServerModal
          server={server}
          close={() => setEditing(false)}
          saved={() => void load()}
        />
      )}
      <div className="detail-tabs">
        {["Overview", "Metrics", "Services", "SSH access"].map((item) => (
          <button
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <>
          <div className="health-banner">
            <div>
              <span className="pulse-icon">
                {checking ? (
                  <span className="tiny-spinner" />
                ) : (
                  <Activity size={17} />
                )}
              </span>
              <div>
                <strong>
                  {checking ? "Collecting health over SSH..." : server.status}
                </strong>
                <p>
                  {snapshot
                    ? `SSH health collected ${new Date(snapshot.capturedAt).toLocaleString()}`
                    : "No SSH health snapshot collected yet."}
                </p>
              </div>
            </div>
            <button onClick={() => void check()} disabled={checking}>
              Run health check <ArrowRight size={15} />
            </button>
          </div>
          <Specifications server={server} />
          <Metrics snapshot={snapshot} />
          <Services server={server} />
        </>
      )}
      {tab === "Metrics" && (
        <div className="tab-demo-content">
          <Metrics snapshot={snapshot} />
        </div>
      )}
      {tab === "Services" && (
        <div className="tab-demo-content">
          <Services server={server} />
        </div>
      )}
      {tab === "SSH access" && (
        <div className="tab-demo-content ssh-access-card">
          <KeyRound size={24} />
          <div>
            <span className="page-eyebrow">Managed access</span>
            <h2>SSH fingerprint</h2>
            <p>
              {server.fingerprint || "Backend did not return a fingerprint."}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={testing}
            onClick={() => void test()}
          >
            Test SSH connection
          </button>
        </div>
      )}
    </div>
  );
}

function Specifications({ server }: { server: Server }) {
  const specification = server.specification;
  const values = [
    ["CPU model", specification.cpuModel],
    ["CPU cores", specification.cpuCores && `${specification.cpuCores} logical cores`],
    ["Installed memory", specification.memoryTotalBytes && formatBytes(specification.memoryTotalBytes)],
    ["Root disk capacity", specification.diskTotalBytes && formatBytes(specification.diskTotalBytes)],
    ["Architecture", specification.architecture],
    ["Kernel", specification.kernel],
    ["Hostname", specification.hostname],
    ["Virtualization", specification.virtualization],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);

  return (
    <section className="specification-panel" aria-labelledby="server-specifications-heading">
      <div className="specification-head">
        <span className="page-eyebrow">Hardware profile</span>
        <h2 id="server-specifications-heading">Server specifications</h2>
      </div>
      {values.length ? (
        <dl className="specification-grid">
          {values.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="server-empty-panel compact">Run health check to collect hardware specifications.</div>
      )}
    </section>
  );
}

function Metrics({ snapshot }: { snapshot: Server["latestSnapshot"] }) {
  return snapshot ? (
    <div className="metric-grid">
      <ResourceCard label="CPU usage" value={snapshot.cpuPercent} icon={Cpu} />
      <ResourceCard
        label="Memory"
        value={snapshot.memoryPercent}
        icon={MemoryStick}
      />
      <ResourceCard
        label="Disk usage"
        value={snapshot.diskPercent}
        icon={HardDrive}
      />
    </div>
  ) : (
    <div className="server-empty-panel">
      No metrics collected yet. Run SSH health check to collect them.
    </div>
  );
}
function ResourceCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Cpu;
}) {
  return (
    <div className="resource-card">
      <div className="resource-card-top">
        <span>
          <i>
            <Icon size={17} />
          </i>
          {label}
        </span>
        <em>Latest snapshot</em>
      </div>
      <div className="resource-value">
        <strong>{value}%</strong>
      </div>
      <div className="snapshot-bar">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
function Services({ server }: { server: Server }) {
  return (
    <section className="panel full-panel">
      <div className="panel-head">
        <div>
          <span className="page-eyebrow">Runtime</span>
          <h3>Services</h3>
          <p>Latest backend snapshot</p>
        </div>
      </div>
      {server.services.length ? (
        server.services.map((service) => (
          <div className="service-row service-readonly" key={service.name}>
            <i className="service-icon">
              <Activity size={16} />
            </i>
            <span>
              <strong>{service.name}</strong>
              <small>{service.detail || "No details"}</small>
            </span>
            <b className={service.status.toLowerCase()}>
              <i /> {service.status}
            </b>
          </div>
        ))
      ) : (
        <div className="server-empty-panel compact">
          No services returned for this server.
        </div>
      )}
    </section>
  );
}
