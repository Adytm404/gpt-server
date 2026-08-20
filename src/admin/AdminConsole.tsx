import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  Gauge,
  Layers3,
  Plus,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  adminApi,
  type HistoryEvent,
  type Model,
  type Plan,
} from "../api/admin";
import "./admin.css";

const emptyPlan: Plan = {
  id: "",
  name: "",
  slug: "",
  description: "",
  priceCents: 0,
  annualPriceCents: 0,
  status: "Draft",
  maxWorkspaces: 0,
  maxServers: 0,
  monthlyTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  overLimit: "Block requests",
  defaultModel: "",
  fallbackModel: "",
  allowedModels: [],
  features: [],
  visibility: "Private",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";
const notify = (text: string) =>
  window.dispatchEvent(
    new CustomEvent<string>("opsai:toast", { detail: text }),
  );

export default function AdminConsole() {
  return (
    <div className="admin-console page-enter">
      <Routes>
        <Route index element={<Navigate to="models" replace />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="plans/new" element={<PlanEditor />} />
        <Route path="plans/:planID" element={<PlanEditor />} />
        <Route path="plans/:planID/preview" element={<PlanPreview />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="models" replace />} />
      </Routes>
    </div>
  );
}

function useLoad<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [loader]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, setData, loading, error, setError, load };
}

function PageHead({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-head">
      <div>
        <span className="page-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </header>
  );
}
function Summary({
  items,
}: {
  items: Array<{
    label: string;
    value: string | number;
    detail: string;
    icon: typeof Bot;
  }>;
}) {
  return (
    <div className="admin-summary">
      {items.map(({ label, value, detail, icon: Icon }) => (
        <article key={label}>
          <i>
            <Icon size={17} />
          </i>
          <span>
            <small>{label}</small>
            <strong>{value}</strong>
            <em>{detail}</em>
          </span>
        </article>
      ))}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`admin-status ${value.toLowerCase()}`}>
      <i />
      {value}
    </span>
  );
}
function AsyncState({
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
    <div className="api-state">
      <span className="tiny-spinner" /> Loading...
    </div>
  ) : error ? (
    <div className="api-state error" role="alert">
      <span>{error}</span>
      <button className="button secondary" onClick={retry}>
        Retry
      </button>
    </div>
  ) : empty ? (
    <div className="api-state">{empty}</div>
  ) : null;
}

function ModelsPage() {
  const loader = useCallback(() => adminApi.listModels(), []);
  const {
    data: models,
    setData: setModels,
    loading,
    error,
    setError,
    load,
  } = useLoad(loader, [] as Model[]);
  const [drawer, setDrawer] = useState<Model | "new" | null>(null);
  const [query, setQuery] = useState("");
  const filtered = models.filter((model) =>
    `${model.name} ${model.provider}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const action = async (run: () => Promise<unknown>, success: string) => {
    setError("");
    try {
      await run();
      await load();
      notify(success);
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <main className="admin-page">
      <PageHead
        eyebrow="Inference registry"
        title="Models"
        copy="Control models available across every workspace and plan."
        action={
          <button className="button dark" onClick={() => setDrawer("new")}>
            <Plus size={15} /> Add model
          </button>
        }
      />
      <Summary
        items={[
          {
            label: "Configured",
            value: models.length,
            detail: "Backend registry",
            icon: Bot,
          },
          {
            label: "Available",
            value: models.filter((x) => x.status === "Active").length,
            detail: "Ready for routing",
            icon: CheckCircle2,
          },
          {
            label: "Fallback",
            value: models.find((x) => x.fallback)?.name || "None",
            detail: "Platform default",
            icon: Sparkles,
          },
        ]}
      />
      <section className="admin-panel">
        <div className="admin-toolbar">
          <label>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models..."
            />
          </label>
          <span>{filtered.length} models</span>
        </div>
        <AsyncState
          loading={loading}
          error={error}
          retry={() => void load()}
          empty={!models.length ? "No models configured." : undefined}
        />
        {!loading && !error && models.length > 0 && (
          <div className="admin-table model-table">
            <div className="admin-table-head">
              <span>Model</span>
              <span>Context</span>
              <span>Status</span>
              <span>Routing</span>
              <span />
            </div>
            {filtered.map((model) => (
              <div className="admin-row" key={model.id}>
                <div className="admin-identity">
                  <i>
                    <Bot size={16} />
                  </i>
                  <span>
                    <b>{model.name}</b>
                    <small>
                      {model.provider} / {model.id}
                    </small>
                  </span>
                </div>
                <span className="admin-mono">{model.context}</span>
                <Status value={model.status} />
                <span>
                  {model.fallback ? (
                    <b className="fallback-tag">Fallback</b>
                  ) : (
                    "-"
                  )}
                </span>
                <div className="admin-row-actions">
                  <button
                    title="Set fallback"
                    disabled={model.status === "Disabled"}
                    onClick={() =>
                      void action(
                        () => adminApi.setFallback(model.id),
                        "Fallback model updated",
                      )
                    }
                  >
                    <Sparkles size={14} />
                  </button>
                  <button title="Edit" onClick={() => setDrawer(model)}>
                    <Edit3 size={14} />
                  </button>
                  <button
                    className="action-text"
                    onClick={() =>
                      void action(
                        () =>
                          adminApi.setModelStatus(
                            model.id,
                            model.status === "Active" ? "disabled" : "active",
                          ),
                        "Model availability updated",
                      )
                    }
                  >
                    {model.status === "Active" ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {drawer && (
        <ModelDrawer
          model={drawer === "new" ? null : drawer}
          close={() => setDrawer(null)}
          save={async (model) => {
            const saved = await adminApi.saveModel(model, drawer === "new");
            setModels((current) =>
              drawer === "new"
                ? [...current, saved]
                : current.map((item) => (item.id === saved.id ? saved : item)),
            );
            setDrawer(null);
            notify("Model configuration saved");
          }}
        />
      )}
    </main>
  );
}

function ModelDrawer({
  model,
  close,
  save,
}: {
  model: Model | null;
  close: () => void;
  save: (model: Model) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Model>(
    model || {
      id: "",
      modelId: "",
      name: "",
      provider: "",
      context: "",
      baseUrl: "",
      status: "Active",
      fallback: false,
      credentialConfigured: false,
      credentialRef: "",
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await save(draft);
    } catch (caught) {
      setError(message(caught));
      setSaving(false);
    }
  };
  return (
    <div className="admin-overlay">
      <button
        className="admin-scrim"
        onClick={close}
        aria-label="Close drawer"
      />
      <form className="admin-drawer" onSubmit={submit}>
        <header>
          <div>
            <span className="page-eyebrow">Model registry</span>
            <h2>{model ? "Edit model" : "Add model"}</h2>
            <p>Configuration persists to platform API.</p>
          </div>
          <button type="button" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="admin-form">
          <label>
            <span>Display name</span>
            <input
              required
              value={draft.name}
              placeholder="GPT-4.1 Mini"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            <span>Model ID</span>
            <input
              required
              value={draft.modelId || ""}
              placeholder="gpt-4.1-mini"
              onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
            />
          </label>
          <div className="two-fields">
            <label>
              <span>Provider</span>
              <input
                value={draft.provider}
                placeholder="OpenAI-compatible"
                onChange={(e) =>
                  setDraft({ ...draft, provider: e.target.value })
                }
              />
            </label>
            <label>
              <span>Context window</span>
              <input
                value={draft.context}
                placeholder="128K"
                onChange={(e) =>
                  setDraft({ ...draft, context: e.target.value })
                }
              />
            </label>
          </div>
          <label>
            <span>OpenAI-compatible base URL</span>
            <input
              aria-label="OpenAI-compatible base URL"
              value={draft.baseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
            <small>
              Endpoint must expose OpenAI-compatible /chat/completions.
            </small>
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={draft.status === "Active"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.checked ? "Active" : "Disabled",
                })
              }
            />
            <span>
              <b>Available for routing</b>
              <small>Plans can select this model when active.</small>
            </span>
          </label>
          <label>
            <span>Credential reference (optional)</span>
            <input
              value={draft.credentialRef || ""}
              onChange={(e) => setDraft({ ...draft, credentialRef: e.target.value })}
              placeholder="vault://models/openai"
            />
            <small>
              Credential reference points to a server-side secret and is not an API key.
            </small>
            {draft.credentialConfigured && <small>Credential currently configured. Leave unchanged to preserve it.</small>}
          </label>
          {error && (
            <div className="inline-api-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button className="button dark" disabled={saving}>
            <Save size={14} /> {saving ? "Saving..." : "Save model"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function PlansPage() {
  const navigate = useNavigate();
  const loader = useCallback(() => adminApi.listPlans(), []);
  const {
    data: plans,
    setData: setPlans,
    loading,
    error,
    setError,
    load,
  } = useLoad(loader, [] as Plan[]);
  const mutate = async (run: () => Promise<void>, success: string) => {
    setError("");
    try {
      await run();
      notify(success);
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <main className="admin-page">
      <PageHead
        eyebrow="Commercial catalog"
        title="Plans"
        copy="Define pricing, limits, model access, and customer-facing entitlements."
        action={
          <NavLink className="button dark" to="/admin/plans/new">
            <Plus size={15} /> Create plan
          </NavLink>
        }
      />
      <Summary
        items={[
          {
            label: "Published",
            value: plans.filter((x) => x.status === "Published").length,
            detail: "Visible catalog plans",
            icon: CheckCircle2,
          },
          {
            label: "Drafts",
            value: plans.filter((x) => x.status === "Draft").length,
            detail: "Awaiting review",
            icon: Edit3,
          },
          {
            label: "Archived",
            value: plans.filter((x) => x.status === "Archived").length,
            detail: "Retired catalog plans",
            icon: Archive,
          },
        ]}
      />
      <section className="admin-panel">
        <AsyncState
          loading={loading}
          error={error}
          retry={() => void load()}
          empty={!plans.length ? "No plans configured." : undefined}
        />
        {!loading && !error && plans.length > 0 && (
          <div className="admin-table plans-table">
            <div className="admin-table-head">
              <span>Plan</span>
              <span>Price</span>
              <span>Capacity</span>
              <span>Status</span>
              <span />
            </div>
            {plans.map((plan) => (
              <div className="admin-row" key={plan.id}>
                <div className="admin-identity">
                  <i>
                    <Layers3 size={16} />
                  </i>
                  <span>
                    <b>{plan.name}</b>
                    <small>
                      /{plan.slug} / {plan.visibility}
                    </small>
                  </span>
                </div>
                <span className="plan-table-price">
                  <b>${(plan.priceCents / 100).toFixed(0)}</b>
                  <small>/ month</small>
                </span>
                <span>
                  <b>{plan.maxServers}</b>
                  <small> servers / workspace</small>
                </span>
                <Status value={plan.status} />
                <div className="admin-row-actions">
                  <button
                    title="Edit"
                    onClick={() => navigate(`/admin/plans/${plan.id}`)}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    title="Duplicate"
                    onClick={() =>
                      void mutate(async () => {
                        const copy = await adminApi.duplicatePlan(plan.id);
                        setPlans((current) => [...current, copy]);
                      }, "Draft duplicate created")
                    }
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    title="Preview"
                    onClick={() => navigate(`/admin/plans/${plan.id}/preview`)}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    title="Archive"
                    disabled={plan.status === "Archived"}
                    onClick={() =>
                      void mutate(async () => {
                        await adminApi.archivePlan(plan.id);
                        setPlans((current) => current.filter((item) => item.id !== plan.id));
                      }, "Plan archived")
                    }
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function PlanEditor() {
  const { planID } = useParams();
  const navigate = useNavigate();
  const create = !planID;
  const [draft, setDraft] = useState<Plan>(emptyPlan);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(!create);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [modelList, plan] = await Promise.all([
        adminApi.listModels(),
        planID ? adminApi.getPlan(planID) : Promise.resolve(emptyPlan),
      ]);
      setModels(modelList);
      setDraft(plan);
    } catch (caught) {
      setLoadError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [planID]);
  useEffect(() => {
    void load();
  }, [load]);
  const setNumber = (field: keyof Plan, value: string) =>
    setDraft((current) => ({
      ...current,
      [field]: Math.max(0, Number.parseInt(value || "0", 10)),
    }));
  const save = async (openPreview = false) => {
    setSaving(true);
    setMutationError("");
    try {
      const normalized = {
        ...draft,
        id:
          draft.id ||
          draft.slug ||
          draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      };
      const saved = await adminApi.savePlan(normalized, create);
      setDraft(saved);
      notify("Draft saved");
      navigate(
        openPreview
          ? `/admin/plans/${saved.id}/preview`
          : `/admin/plans/${saved.id}`,
        { replace: true },
      );
    } catch (caught) {
      setMutationError(message(caught));
    } finally {
      setSaving(false);
    }
  };
  const toggleModel = (id: string) =>
    setDraft((current) => ({
      ...current,
      allowedModels: current.allowedModels.includes(id)
        ? current.allowedModels.filter((item) => item !== id)
        : [...current.allowedModels, id],
    }));
  if (loading || loadError)
    return (
      <main className="admin-page">
        <AsyncState loading={loading} error={loadError} retry={() => void load()} />
      </main>
    );
  return (
    <main className="admin-page editor-page">
      <button className="admin-back" onClick={() => navigate("/admin/plans")}>
        <ArrowLeft size={14} /> Plans
      </button>
      <PageHead
        eyebrow={create ? "New catalog plan" : `Editing / ${draft.slug}`}
        title={create ? "Create plan" : draft.name}
        copy="Set commercial identity and enforceable workspace entitlements."
        action={
          <div className="head-actions">
            <button
              className="button secondary"
              disabled={saving}
              onClick={() => void save(true)}
            >
              <Eye size={14} /> Preview
            </button>
            <button
              className="button dark"
              disabled={saving}
              onClick={() => void save()}
            >
              <Save size={14} /> {saving ? "Saving..." : "Save draft"}
            </button>
          </div>
        }
      />
      {mutationError && (
        <div className="inline-api-error" role="alert">
          {mutationError}
        </div>
      )}
      <div className="editor-layout">
        <div className="editor-main">
          <EditorSection
            number="01"
            title="Identity & pricing"
            copy="Customer-facing plan details and monthly-equivalent pricing."
          >
            <div className="admin-form grid">
              <label>
                <span>Plan name</span>
                <input
                  value={draft.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      name: e.target.value,
                      slug:
                        draft.slug ||
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-"),
                    })
                  }
                />
              </label>
              <label>
                <span>Slug</span>
                <input
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </label>
              <label className="wide">
                <span>Description</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <NumberField
                label="Monthly price (cents)"
                value={draft.priceCents}
                update={(value) => setNumber("priceCents", value)}
              />
              <NumberField
                label="Annual monthly-equivalent (cents)"
                value={draft.annualPriceCents}
                update={(value) => setNumber("annualPriceCents", value)}
              />
              <label>
                <span>Visibility</span>
                <select
                  value={draft.visibility}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visibility: e.target.value as Plan["visibility"],
                    })
                  }
                >
                  <option>Private</option>
                  <option>Public</option>
                </select>
              </label>
            </div>
          </EditorSection>
          <EditorSection
            number="02"
            title="Capacity & token policy"
            copy="Hard workspace limits consumed by application policy."
          >
            <div className="admin-form grid three">
              <NumberField
                label="Max workspaces"
                value={draft.maxWorkspaces}
                update={(v) => setNumber("maxWorkspaces", v)}
              />
              <NumberField
                label="Servers / workspace"
                value={draft.maxServers}
                update={(v) => setNumber("maxServers", v)}
              />
              <NumberField
                label="Monthly tokens"
                value={draft.monthlyTokens}
                update={(v) => setNumber("monthlyTokens", v)}
              />
              <NumberField
                label="Max input"
                value={draft.inputTokens}
                update={(v) => setNumber("inputTokens", v)}
              />
              <NumberField
                label="Max output"
                value={draft.outputTokens}
                update={(v) => setNumber("outputTokens", v)}
              />
              <label>
                <span>Over-limit behavior</span>
                <select
                  value={draft.overLimit}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      overLimit: e.target.value as Plan["overLimit"],
                    })
                  }
                >
                  <option>Block requests</option>
                  <option>Allow with warning</option>
                </select>
              </label>
            </div>
          </EditorSection>
          <EditorSection
            number="03"
            title="Model routing"
            copy="Default route, resilience fallback, and available model set."
          >
            <div className="admin-form grid">
              <label>
                <span>Default model</span>
                <select
                  value={draft.defaultModel}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultModel: e.target.value })
                  }
                >
                  <option value="">Select model</option>
                  {models.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Fallback model</span>
                <select
                  value={draft.fallbackModel}
                  onChange={(e) =>
                    setDraft({ ...draft, fallbackModel: e.target.value })
                  }
                >
                  <option value="">Select model</option>
                  {models.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="model-selector wide">
                {models.map((model) => (
                  <label key={model.id}>
                    <input
                      type="checkbox"
                      checked={draft.allowedModels.includes(model.id)}
                      onChange={() => toggleModel(model.id)}
                    />
                    <i>
                      <Bot size={14} />
                    </i>
                    <span>
                      <b>{model.name}</b>
                      <small>{model.provider}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </EditorSection>
          <EditorSection
            number="04"
            title="Feature list"
            copy="One customer-facing entitlement per line."
          >
            <div className="admin-form">
              <label>
                <span>Included features</span>
                <textarea
                  rows={6}
                  value={draft.features.join("\n")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      features: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          </EditorSection>
        </div>
        <aside className="editor-aside">
          <span className="page-eyebrow">Plan integrity</span>
          <div className="integrity-score">
            <Gauge size={18} />
            <span>
              <b>
                {draft.name && draft.slug && draft.allowedModels.length
                  ? "Ready to review"
                  : "Needs configuration"}
              </b>
              <small>
                {draft.allowedModels.length} models / {draft.features.length}{" "}
                features
              </small>
            </span>
          </div>
          <dl>
            <div>
              <dt>Monthly price</dt>
              <dd>${(draft.priceCents / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Status value={draft.status} />
              </dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>{draft.visibility}</dd>
            </div>
          </dl>
          <button
            className="button secondary"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Open customer preview <ArrowRight size={14} />
          </button>
        </aside>
      </div>
    </main>
  );
}

function NumberField({
  label,
  value,
  update,
}: {
  label: string;
  value: number;
  update: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => update(e.target.value)}
      />
    </label>
  );
}
function EditorSection({
  number,
  title,
  copy,
  children,
}: {
  number: string;
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <section className="editor-section">
      <header>
        <i>{number}</i>
        <span>
          <h2>{title}</h2>
          <p>{copy}</p>
        </span>
      </header>
      {children}
    </section>
  );
}

function PlanPreview() {
  const { planID = "" } = useParams();
  const navigate = useNavigate();
  const loader = useCallback(() => adminApi.previewPlan(planID), [planID]);
  const {
    data: plan,
    setData: setPlan,
    loading,
    error,
    setError,
    load,
  } = useLoad(loader, emptyPlan);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    setPublishing(true);
    setError("");
    try {
      setPlan(await adminApi.publishPlan(plan.id));
      setConfirming(false);
      notify("Plan published");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPublishing(false);
    }
  };
  if (loading || error)
    return (
      <main className="admin-page">
        <AsyncState loading={loading} error={error} retry={() => void load()} />
      </main>
    );
  return (
    <main className="admin-page preview-page">
      <button
        className="admin-back"
        onClick={() => navigate(`/admin/plans/${plan.id}`)}
      >
        <ArrowLeft size={14} /> Back to editor
      </button>
      <PageHead
        eyebrow="Customer view"
        title="Plan preview"
        copy="Review pricing presentation and exact entitlement payload before publish."
        action={
          <div className="head-actions">
            <button
              className="button secondary"
              onClick={() => navigate(`/admin/plans/${plan.id}`)}
            >
              <Edit3 size={14} /> Edit
            </button>
            <button
              className="button dark"
              onClick={() => setConfirming(true)}
              disabled={plan.status === "Published"}
            >
              <Send size={14} />{" "}
              {plan.status === "Published" ? "Published" : "Publish plan"}
            </button>
          </div>
        }
      />
      <div className="preview-stage">
        <article className="preview-plan-card">
          <div className="draft-ribbon">{plan.status.toUpperCase()}</div>
          <span className="page-eyebrow">For operational teams</span>
          <h2>{plan.name}</h2>
          <p>{plan.description}</p>
          <div className="preview-price">
            <sup>$</sup>
            <strong>{Math.floor(plan.priceCents / 100)}</strong>
            <span>
              <b>.{String(plan.priceCents % 100).padStart(2, "0")}</b>
              <small>/ workspace / month</small>
            </span>
          </div>
          <button className="button dark">
            Choose {plan.name} <ArrowRight size={14} />
          </button>
          <div className="preview-features">
            <span>WHAT'S INCLUDED</span>
            {plan.features.map((feature) => (
              <p key={feature}>
                <Check size={13} /> {feature}
              </p>
            ))}
          </div>
        </article>
        <section className="entitlement-sheet">
          <header>
            <span>
              <ShieldCheck size={16} /> Entitlement summary
            </span>
            <b>POLICY PREVIEW</b>
          </header>
          <div className="entitlement-grid">
            <Entitlement
              label="Annual price / month"
              value={`$${(plan.annualPriceCents / 100).toFixed(2)}`}
            />
            <Entitlement
              label="Workspaces"
              value={String(plan.maxWorkspaces)}
            />
            <Entitlement
              label="Servers / workspace"
              value={String(plan.maxServers)}
            />
            <Entitlement
              label="Monthly tokens"
              value={plan.monthlyTokens.toLocaleString()}
            />
            <Entitlement
              label="Max input / request"
              value={plan.inputTokens.toLocaleString()}
            />
            <Entitlement
              label="Max output / request"
              value={plan.outputTokens.toLocaleString()}
            />
          </div>
          <dl>
            <div>
              <dt>Default model</dt>
              <dd>{plan.defaultModel}</dd>
            </div>
            <div>
              <dt>Fallback model</dt>
              <dd>{plan.fallbackModel}</dd>
            </div>
            <div>
              <dt>Allowed models</dt>
              <dd>{plan.allowedModels.length}</dd>
            </div>
            <div>
              <dt>Over-limit policy</dt>
              <dd>{plan.overLimit}</dd>
            </div>
          </dl>
          <footer>Preview loaded from persisted catalog state.</footer>
        </section>
      </div>
      {confirming && (
        <div className="admin-overlay modal">
          <button
            className="admin-scrim"
            onClick={() => setConfirming(false)}
          />
          <section className="publish-modal">
            <header>
              <i>
                <Send size={18} />
              </i>
              <span>
                <span className="page-eyebrow">Final review</span>
                <h2>Publish {plan.name}?</h2>
                <p>{plan.visibility === "Public" ? "Changes become visible in public catalog." : "Plan will be published but remain hidden from public catalog while visibility is Private."}</p>
              </span>
            </header>
            <div className="publish-diff">
              <span>CHANGE SET</span>
              <div>
                <i>+</i>
                <p>
                  <b>Status</b>
                  <small>{plan.status}</small>
                </p>
                <ArrowRight size={13} />
                <strong>Published</strong>
              </div>
              <div>
                <i>~</i>
                <p>
                  <b>Visibility</b>
                  <small>Unchanged</small>
                </p>
                <ArrowRight size={13} />
                <strong>{plan.visibility}</strong>
              </div>
            </div>
            <footer>
              <button
                className="button secondary"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                className="button dark"
                disabled={publishing}
                onClick={() => void publish()}
              >
                {publishing ? "Publishing..." : "Confirm & publish"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
function Entitlement({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryPage() {
  const loader = useCallback(() => adminApi.history(), []);
  const {
    data: history,
    loading,
    error,
    load,
  } = useLoad(loader, [] as HistoryEvent[]);
  const [type, setType] = useState("All");
  const [query, setQuery] = useState("");
  const events = history.filter(
    (event) =>
      (type === "All" || `${event.resourceType}s` === type.toLowerCase()) &&
      `${event.action} ${event.target_name} ${event.actorName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <main className="admin-page">
      <PageHead
        eyebrow="Platform audit"
        title="Change history"
        copy="Trace administrative catalog and routing changes across platform control."
      />
      <section className="admin-panel history-panel">
        <div className="admin-toolbar">
          <label>
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search history..."
            />
          </label>
          <div className="history-filters">
            {["All", "Models", "Plans", "Servers"].map((item) => (
              <button
                className={type === item ? "active" : ""}
                onClick={() => setType(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <AsyncState
          loading={loading}
          error={error}
          retry={() => void load()}
          empty={!events.length ? "No history events found." : undefined}
        />
        {!loading && !error && (
          <div className="history-list">
            {events.map((event, index) => (
              <article key={event.id}>
                <i className={`${event.resourceType}s`}>
                  {event.resourceType === "model" ? (
                    <Bot size={14} />
                  ) : event.resourceType === "server" ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <Layers3 size={14} />
                  )}
                </i>
                <span>
                  <b>{event.action}</b>
                  <p>{event.target_name}</p>
                  <small>{event.actorName}</small>
                </span>
                <em>{new Date(event.created_at).toLocaleString()}</em>
                {index < events.length - 1 && <div />}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
