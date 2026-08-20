import { useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  Activity, Archive, ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, CircleDollarSign,
  Clock3, Copy, Edit3, Eye, FlaskConical, Gauge, Layers3, MoreHorizontal,
  Plus, Save, Search, Send, ShieldCheck, Sparkles, X,
} from 'lucide-react'
import { historyEvents, initialModels, initialPlans, type Model, type Plan } from './adminData'
import './admin.css'

const emptyPlan: Plan = { id: '', name: '', slug: '', description: '', priceCents: 0, annualPriceCents: 0, status: 'Draft', maxWorkspaces: 1, maxServers: 3, monthlyTokens: 1000000, inputTokens: 32000, outputTokens: 8000, overLimit: 'Block requests', defaultModel: 'gpt-5-mini', fallbackModel: 'gemini-flash', allowedModels: ['gpt-5-mini'], features: ['Approval-first execution'], visibility: 'Private', subscribers: 0 }

export default function AdminConsole() {
  const [models, setModels] = useState(initialModels)
  const [plans, setPlans] = useState(initialPlans)
  const notify = (message: string) => window.dispatchEvent(new CustomEvent<string>('opsai:toast', { detail: message }))
  return <div className="admin-console page-enter">
    <Routes>
      <Route index element={<Navigate to="models" replace />} />
      <Route path="models" element={<ModelsPage models={models} setModels={setModels} notify={notify} />} />
      <Route path="plans" element={<PlansPage plans={plans} setPlans={setPlans} notify={notify} />} />
      <Route path="plans/new" element={<PlanEditor plans={plans} setPlans={setPlans} models={models} notify={notify} />} />
      <Route path="plans/:planID" element={<PlanEditor plans={plans} setPlans={setPlans} models={models} notify={notify} />} />
      <Route path="plans/:planID/preview" element={<PlanPreview plans={plans} setPlans={setPlans} />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="*" element={<Navigate to="models" replace />} />
    </Routes>
  </div>
}

function PageHead({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <header className="admin-head"><div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</header>
}

function Summary({ items }: { items: Array<{ label: string; value: string | number; detail: string; icon: typeof Bot }> }) {
  return <div className="admin-summary">{items.map(({ label, value, detail, icon: Icon }) => <article key={label}><i><Icon size={17} /></i><span><small>{label}</small><strong>{value}</strong><em>{detail}</em></span></article>)}</div>
}

function ModelsPage({ models, setModels, notify }: { models: Model[]; setModels: React.Dispatch<React.SetStateAction<Model[]>>; notify: (message: string) => void }) {
  const [drawer, setDrawer] = useState<Model | 'new' | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const filtered = models.filter(model => `${model.name} ${model.provider}`.toLowerCase().includes(query.toLowerCase()))
  const test = (model: Model) => { setTesting(model.id); window.setTimeout(() => { setTesting(null); notify(`${model.name} responded in ${model.latency}`) }, 900) }
  const fallback = (id: string) => { setModels(current => current.map(model => ({ ...model, fallback: model.id === id }))); notify('Fallback model updated') }
  const toggle = (id: string) => { setModels(current => current.map(model => model.id === id ? { ...model, status: model.status === 'Active' ? 'Disabled' : 'Active' } : model)); notify('Model availability updated') }
  return <main className="admin-page">
    <PageHead eyebrow="Inference registry" title="Models" copy="Control models available across every workspace and plan." action={<button className="button dark" onClick={() => setDrawer('new')}><Plus size={15} /> Add model</button>} />
    <Summary items={[{ label: 'Configured', value: models.length, detail: 'Across 4 providers', icon: Bot }, { label: 'Available', value: models.filter(x => x.status === 'Active').length, detail: 'Ready for routing', icon: CheckCircle2 }, { label: 'Fallback', value: models.find(x => x.fallback)?.name || 'None', detail: 'Platform default', icon: Sparkles }]} />
    <section className="admin-panel"><div className="admin-toolbar"><label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search models..." /></label><span>{filtered.length} model{filtered.length === 1 ? '' : 's'}</span></div>
      <div className="admin-table model-table"><div className="admin-table-head"><span>Model</span><span>Context</span><span>Latency</span><span>Status</span><span>Routing</span><span /></div>{filtered.map(model => <div className="admin-row" key={model.id}><div className="admin-identity"><i><Bot size={16} /></i><span><b>{model.name}</b><small>{model.provider} / {model.id}</small></span></div><span className="admin-mono">{model.context}</span><span>{model.latency}</span><Status value={model.status} /><span>{model.fallback ? <b className="fallback-tag">Fallback</b> : '-'}</span><div className="admin-row-actions"><button title="Test model" onClick={() => test(model)} disabled={testing === model.id}>{testing === model.id ? <span className="tiny-spinner" /> : <FlaskConical size={14} />}</button><button title="Set fallback" onClick={() => fallback(model.id)} disabled={model.status === 'Disabled'}><Sparkles size={14} /></button><button title="Edit" onClick={() => setDrawer(model)}><Edit3 size={14} /></button><button className="action-text" onClick={() => toggle(model.id)}>{model.status === 'Active' ? 'Disable' : 'Enable'}</button></div></div>)}</div>
    </section>{drawer && <ModelDrawer model={drawer === 'new' ? null : drawer} close={() => setDrawer(null)} save={model => { setModels(current => drawer === 'new' ? [...current, model] : current.map(item => item.id === model.id ? model : item)); setDrawer(null); notify('Model configuration saved') }} />}
  </main>
}

function ModelDrawer({ model, close, save }: { model: Model | null; close: () => void; save: (model: Model) => void }) {
  const [draft, setDraft] = useState<Model>(model || { id: '', name: '', provider: 'OpenAI', context: '128K', status: 'Active', fallback: false, latency: '-' })
  const submit = (event: FormEvent) => { event.preventDefault(); save({ ...draft, id: draft.id || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }) }
  return <div className="admin-overlay"><button className="admin-scrim" onClick={close} aria-label="Close drawer" /><form className="admin-drawer" onSubmit={submit}><header><div><span className="page-eyebrow">Model registry</span><h2>{model ? 'Edit model' : 'Add model'}</h2><p>Frontend-only configuration preview.</p></div><button type="button" onClick={close}><X size={18} /></button></header><div className="admin-form"><label><span>Display name</span><input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="GPT-5 mini" /></label><label><span>Model ID</span><input required value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="gpt-5-mini" /></label><div className="two-fields"><label><span>Provider</span><select value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })}><option>OpenAI</option><option>Anthropic</option><option>Google</option><option>Groq</option></select></label><label><span>Context window</span><input value={draft.context} onChange={e => setDraft({ ...draft, context: e.target.value })} /></label></div><label className="admin-check"><input type="checkbox" checked={draft.status === 'Active'} onChange={e => setDraft({ ...draft, status: e.target.checked ? 'Active' : 'Disabled' })} /><span><b>Available for routing</b><small>Plans can select this model when active.</small></span></label></div><footer><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button dark"><Save size={14} /> Save model</button></footer></form></div>
}

function PlansPage({ plans, setPlans, notify }: { plans: Plan[]; setPlans: React.Dispatch<React.SetStateAction<Plan[]>>; notify: (message: string) => void }) {
  const navigate = useNavigate()
  const duplicate = (plan: Plan) => { const copy = { ...plan, id: `${plan.id}-copy`, name: `${plan.name} Copy`, slug: `${plan.slug}-copy`, status: 'Draft' as const, subscribers: 0 }; setPlans(current => [...current, copy]); notify('Draft duplicate created') }
  const archive = (id: string) => { setPlans(current => current.map(plan => plan.id === id ? { ...plan, status: 'Archived' } : plan)); notify('Plan archived') }
  return <main className="admin-page"><PageHead eyebrow="Commercial catalog" title="Plans" copy="Define pricing, limits, model access, and customer-facing entitlements." action={<NavLink className="button dark" to="/admin/plans/new"><Plus size={15} /> Create plan</NavLink>} />
    <Summary items={[{ label: 'Published', value: plans.filter(x => x.status === 'Published').length, detail: 'Visible catalog plans', icon: CheckCircle2 }, { label: 'Drafts', value: plans.filter(x => x.status === 'Draft').length, detail: 'Awaiting review', icon: Edit3 }, { label: 'Subscribers', value: plans.reduce((sum, x) => sum + x.subscribers, 0), detail: 'Active workspaces', icon: Activity }]} />
    <section className="admin-panel"><div className="admin-table plans-table"><div className="admin-table-head"><span>Plan</span><span>Price</span><span>Capacity</span><span>Subscribers</span><span>Status</span><span /></div>{plans.map(plan => <div className="admin-row" key={plan.id}><div className="admin-identity"><i><Layers3 size={16} /></i><span><b>{plan.name}</b><small>/{plan.slug} / {plan.visibility}</small></span></div><span className="plan-table-price"><b>${(plan.priceCents / 100).toFixed(0)}</b><small>/ month</small></span><span><b>{plan.maxServers}</b><small> servers / workspace</small></span><span>{plan.subscribers}</span><Status value={plan.status} /><div className="admin-row-actions"><button title="Edit" onClick={() => navigate(`/admin/plans/${plan.id}`)}><Edit3 size={14} /></button><button title="Duplicate" onClick={() => duplicate(plan)}><Copy size={14} /></button><button title="Preview" onClick={() => navigate(`/admin/plans/${plan.id}/preview`)}><Eye size={14} /></button><button title="Archive" onClick={() => archive(plan.id)} disabled={plan.status === 'Archived'}><Archive size={14} /></button></div></div>)}</div></section>
  </main>
}

function Status({ value }: { value: string }) { return <span className={`admin-status ${value.toLowerCase()}`}><i />{value}</span> }

function PlanEditor({ plans, setPlans, models, notify }: { plans: Plan[]; setPlans: React.Dispatch<React.SetStateAction<Plan[]>>; models: Model[]; notify: (message: string) => void }) {
  const { planID } = useParams()
  const navigate = useNavigate()
  const existing = plans.find(plan => plan.id === planID)
  const [draft, setDraft] = useState<Plan>(existing || emptyPlan)
  const setNumber = (field: keyof Plan, value: string) => setDraft({ ...draft, [field]: Math.max(0, Number.parseInt(value || '0', 10)) })
  const save = () => { const next = { ...draft, id: draft.id || draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }; setPlans(current => existing ? current.map(plan => plan.id === existing.id ? next : plan) : [...current, next]); notify('Draft saved'); navigate(`/admin/plans/${next.id}`, { replace: true }) }
  const preview = () => { save(); const id = draft.id || draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); navigate(`/admin/plans/${id}/preview`) }
  const toggleModel = (id: string) => setDraft({ ...draft, allowedModels: draft.allowedModels.includes(id) ? draft.allowedModels.filter(item => item !== id) : [...draft.allowedModels, id] })
  return <main className="admin-page editor-page"><button className="admin-back" onClick={() => navigate('/admin/plans')}><ArrowLeft size={14} /> Plans</button><PageHead eyebrow={existing ? `Editing / ${existing.slug}` : 'New catalog plan'} title={existing ? existing.name : 'Create plan'} copy="Set commercial identity and enforceable workspace entitlements." action={<div className="head-actions"><button className="button secondary" onClick={preview}><Eye size={14} /> Preview</button><button className="button dark" onClick={save}><Save size={14} /> Save draft</button></div>} />
    <div className="editor-layout"><div className="editor-main"><EditorSection number="01" title="Identity & pricing" copy="Customer-facing plan details and monthly-equivalent pricing."><div className="admin-form grid"><label><span>Plan name</span><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value, slug: draft.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></label><label><span>Slug</span><input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} /></label><label className="wide"><span>Description</span><textarea rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label><label><span>Monthly price <em>integer cents</em></span><div className="input-prefix"><i>¢</i><input type="number" min="0" step="1" value={draft.priceCents} onChange={e => setNumber('priceCents', e.target.value)} /></div></label><label><span>Annual monthly-equivalent <em>integer cents</em></span><div className="input-prefix"><i>¢</i><input type="number" min="0" step="1" value={draft.annualPriceCents} onChange={e => setNumber('annualPriceCents', e.target.value)} /></div></label><label><span>Visibility</span><select value={draft.visibility} onChange={e => setDraft({ ...draft, visibility: e.target.value as Plan['visibility'] })}><option>Private</option><option>Public</option></select></label></div></EditorSection>
      <EditorSection number="02" title="Capacity & token policy" copy="Hard workspace limits consumed by application policy."><div className="admin-form grid three"><NumberField label="Max workspaces" value={draft.maxWorkspaces} update={value => setNumber('maxWorkspaces', value)} /><NumberField label="Servers / workspace" value={draft.maxServers} update={value => setNumber('maxServers', value)} /><NumberField label="Monthly tokens / workspace" value={draft.monthlyTokens} update={value => setNumber('monthlyTokens', value)} /><NumberField label="Max input / request" value={draft.inputTokens} update={value => setNumber('inputTokens', value)} /><NumberField label="Max output / request" value={draft.outputTokens} update={value => setNumber('outputTokens', value)} /><label><span>Over-limit behavior</span><select value={draft.overLimit} onChange={e => setDraft({ ...draft, overLimit: e.target.value as Plan['overLimit'] })}><option>Block requests</option><option>Allow with warning</option></select></label></div></EditorSection>
      <EditorSection number="03" title="Model routing" copy="Default route, resilience fallback, and available model set."><div className="admin-form grid"><label><span>Default model</span><select value={draft.defaultModel} onChange={e => setDraft({ ...draft, defaultModel: e.target.value })}>{models.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label><span>Fallback model</span><select value={draft.fallbackModel} onChange={e => setDraft({ ...draft, fallbackModel: e.target.value })}>{models.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label><div className="model-selector wide">{models.map(model => <label key={model.id}><input type="checkbox" checked={draft.allowedModels.includes(model.id)} onChange={() => toggleModel(model.id)} /><i><Bot size={14} /></i><span><b>{model.name}</b><small>{model.provider}</small></span></label>)}</div></div></EditorSection>
      <EditorSection number="04" title="Feature list" copy="One customer-facing entitlement per line."><div className="admin-form"><label><span>Included features</span><textarea rows={6} value={draft.features.join('\n')} onChange={e => setDraft({ ...draft, features: e.target.value.split('\n').filter(Boolean) })} /></label></div></EditorSection></div>
      <aside className="editor-aside"><span className="page-eyebrow">Plan integrity</span><div className="integrity-score"><Gauge size={18} /><span><b>{draft.name && draft.slug && draft.allowedModels.length ? 'Ready to review' : 'Needs configuration'}</b><small>{draft.allowedModels.length} models / {draft.features.length} features</small></span></div><dl><div><dt>Monthly price</dt><dd>${(draft.priceCents / 100).toFixed(2)}</dd></div><div><dt>Annual equivalent</dt><dd>${(draft.annualPriceCents / 100).toFixed(2)} / mo</dd></div><div><dt>Status</dt><dd><Status value={draft.status} /></dd></div><div><dt>Visibility</dt><dd>{draft.visibility}</dd></div></dl><button className="button secondary" onClick={preview}>Open customer preview <ArrowRight size={14} /></button></aside></div>
  </main>
}

function NumberField({ label, value, update }: { label: string; value: number; update: (value: string) => void }) { return <label><span>{label}</span><input type="number" min="0" step="1" value={value} onChange={e => update(e.target.value)} /></label> }
function EditorSection({ number, title, copy, children }: { number: string; title: string; copy: string; children: React.ReactNode }) { return <section className="editor-section"><header><i>{number}</i><span><h2>{title}</h2><p>{copy}</p></span></header>{children}</section> }

function PlanPreview({ plans, setPlans }: { plans: Plan[]; setPlans: React.Dispatch<React.SetStateAction<Plan[]>> }) {
  const { planID } = useParams()
  const navigate = useNavigate()
  const plan = plans.find(item => item.id === planID)
  const [confirming, setConfirming] = useState(false)
  if (!plan) return <Navigate to="/admin/plans" replace />
  const publish = () => { setPlans(current => current.map(item => item.id === plan.id ? { ...item, status: 'Published', visibility: 'Public' } : item)); setConfirming(false) }
  return <main className="admin-page preview-page"><button className="admin-back" onClick={() => navigate(`/admin/plans/${plan.id}`)}><ArrowLeft size={14} /> Back to editor</button><PageHead eyebrow="Customer view" title="Plan preview" copy="Review pricing presentation and exact entitlement payload before publish." action={<div className="head-actions"><button className="button secondary" onClick={() => navigate(`/admin/plans/${plan.id}`)}><Edit3 size={14} /> Edit</button><button className="button dark" onClick={() => setConfirming(true)} disabled={plan.status === 'Published'}><Send size={14} /> {plan.status === 'Published' ? 'Published' : 'Publish plan'}</button></div>} />
    <div className="preview-stage"><article className="preview-plan-card"><div className="draft-ribbon">{plan.status.toUpperCase()}</div><span className="page-eyebrow">For operational teams</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="preview-price"><sup>$</sup><strong>{Math.floor(plan.priceCents / 100)}</strong><span><b>.{String(plan.priceCents % 100).padStart(2, '0')}</b><small>/ workspace / month</small></span></div><button className="button dark">Choose {plan.name} <ArrowRight size={14} /></button><div className="preview-features"><span>WHAT'S INCLUDED</span>{plan.features.map(feature => <p key={feature}><Check size={13} /> {feature}</p>)}</div></article><section className="entitlement-sheet"><header><span><ShieldCheck size={16} /> Entitlement summary</span><b>POLICY PREVIEW</b></header><div className="entitlement-grid"><Entitlement label="Annual price / month" value={`$${(plan.annualPriceCents / 100).toFixed(2)}`} /><Entitlement label="Workspaces" value={String(plan.maxWorkspaces)} /><Entitlement label="Servers / workspace" value={String(plan.maxServers)} /><Entitlement label="Monthly tokens" value={plan.monthlyTokens.toLocaleString()} /><Entitlement label="Max input / request" value={plan.inputTokens.toLocaleString()} /><Entitlement label="Max output / request" value={plan.outputTokens.toLocaleString()} /></div><dl><div><dt>Default model</dt><dd>{plan.defaultModel}</dd></div><div><dt>Fallback model</dt><dd>{plan.fallbackModel}</dd></div><div><dt>Allowed models</dt><dd>{plan.allowedModels.length}</dd></div><div><dt>Over-limit policy</dt><dd>{plan.overLimit}</dd></div></dl><footer><Clock3 size={13} /> Preview generated from unsaved in-memory catalog state.</footer></section></div>
    {confirming && <div className="admin-overlay modal"><button className="admin-scrim" onClick={() => setConfirming(false)} /><section className="publish-modal"><header><i><Send size={18} /></i><span><span className="page-eyebrow">Final review</span><h2>Publish {plan.name}?</h2><p>Changes become visible in frontend catalog state.</p></span></header><div className="publish-diff"><span>CHANGE SET</span><div><i>+</i><p><b>Status</b><small>Draft</small></p><ArrowRight size={13} /><strong>Published</strong></div><div><i>+</i><p><b>Visibility</b><small>{plan.visibility}</small></p><ArrowRight size={13} /><strong>Public</strong></div><div><i>~</i><p><b>Entitlements</b><small>Catalog policy</small></p><ArrowRight size={13} /><strong>{plan.allowedModels.length} models</strong></div></div><footer><button className="button secondary" onClick={() => setConfirming(false)}>Cancel</button><button className="button dark" onClick={publish}>Confirm & publish</button></footer></section></div>}
  </main>
}

function Entitlement({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div> }

function HistoryPage() {
  const [type, setType] = useState('All')
  const [query, setQuery] = useState('')
  const events = historyEvents.filter(event => (type === 'All' || event.type === type) && `${event.action} ${event.target} ${event.actor}`.toLowerCase().includes(query.toLowerCase()))
  return <main className="admin-page"><PageHead eyebrow="Platform audit" title="Change history" copy="Trace administrative catalog and routing changes across platform control." />
    <section className="admin-panel history-panel"><div className="admin-toolbar"><label><Search size={14} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search history..." /></label><div className="history-filters">{['All', 'Models', 'Plans'].map(item => <button className={type === item ? 'active' : ''} onClick={() => setType(item)} key={item}>{item}</button>)}</div></div><div className="history-list">{events.map((event, index) => <article key={`${event.action}-${event.time}`}><i className={event.type.toLowerCase()}>{event.type === 'Models' ? <Bot size={14} /> : <Layers3 size={14} />}</i><span><b>{event.action}</b><p>{event.target}</p><small>{event.actor}</small></span><em>{event.time}</em>{index < events.length - 1 && <div />}</article>)}</div></section>
  </main>
}
