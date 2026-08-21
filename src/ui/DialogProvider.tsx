import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type DialogTone = 'default' | 'accent' | 'destructive'
export type DialogDetail = { title: string; detail?: string }
type ConfirmOptions = { title: string; description: string; confirmLabel: string; tone: DialogTone; details?: DialogDetail[] }
type PromptOptions = { title: string; description: string; label: string; initialValue: string; confirmLabel: string }
type NoticeOptions = { title: string; description: string; tone: DialogTone }
type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  notice: (options: NoticeOptions) => Promise<void>
}
type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'notice'; options: NoticeOptions; resolve: () => void }

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog() {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useDialog must be used within DialogProvider')
  return context
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const queue = useRef<Request[]>([])
  const active = useRef<Request | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const enqueue = (next: Request) => {
    if (active.current) queue.current.push(next)
    else { active.current = next; previousFocus.current = document.activeElement as HTMLElement; setRequest(next) }
  }
  const api = useRef<DialogApi>({
    confirm: options => new Promise(resolve => enqueue({ kind: 'confirm', options, resolve })),
    prompt: options => new Promise(resolve => enqueue({ kind: 'prompt', options, resolve })),
    notice: options => new Promise(resolve => enqueue({ kind: 'notice', options, resolve })),
  }).current
  const finish = (value?: boolean | string | null) => {
    const current = active.current
    if (!current) return
    if (current.kind === 'confirm') current.resolve(value === true)
    else if (current.kind === 'prompt') current.resolve(typeof value === 'string' ? value : null)
    else current.resolve()
    active.current = null
    setRequest(null)
    previousFocus.current?.focus()
    queueMicrotask(() => {
      const next = queue.current.shift()
      if (next) { active.current = next; previousFocus.current = document.activeElement as HTMLElement; setRequest(next) }
    })
  }

  return <DialogContext.Provider value={api}>{children}{request && <DialogSurface request={request} finish={finish} />}</DialogContext.Provider>
}

function DialogSurface({ request, finish }: { request: Request; finish: (value?: boolean | string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(request.kind === 'prompt' ? request.options.initialValue : '')
  const { title, description } = request.options
  const tone = request.kind === 'prompt' ? 'default' : request.options.tone
  useEffect(() => {
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ;(request.kind === 'prompt' ? input.current : primary.current)?.focus()
    if (request.kind === 'prompt') input.current?.select()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') finish() }
    document.addEventListener('keydown', escape)
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', escape) }
  }, [])
  const submit = (event: React.FormEvent) => { event.preventDefault(); finish(request.kind === 'prompt' ? value : true) }
  const Icon = tone === 'destructive' ? AlertTriangle : request.kind === 'notice' ? Info : CheckCircle2

  return createPortal(<div className="dialog-layer">
    <button className="dialog-backdrop" aria-label="Cancel dialog" onClick={() => finish()} />
    <section className={`dialog-surface ${tone}`} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-description">
      <form onSubmit={submit}>
        <header className="dialog-header"><i><Icon size={19} /></i><div><h2 id="app-dialog-title">{title}</h2><p id="app-dialog-description">{description}</p></div><button type="button" className="dialog-close" onClick={() => finish()} aria-label="Close dialog"><X size={17} /></button></header>
        {request.kind === 'prompt' && <div className="dialog-prompt"><label htmlFor="app-dialog-input">{request.options.label}</label><input ref={input} id="app-dialog-input" value={value} onChange={event => setValue(event.target.value)} /></div>}
        {request.kind === 'confirm' && request.options.details?.length ? <ol className="dialog-details">{request.options.details.map((detail, index) => <li key={`${detail.title}-${index}`}><i>{index + 1}</i><span><b>{detail.title}</b>{detail.detail && <code>{detail.detail}</code>}</span></li>)}</ol> : null}
        <footer className="dialog-footer">{request.kind !== 'notice' && <button type="button" className="button secondary" onClick={() => finish()}>Cancel</button>}<button ref={primary} type="submit" className={`button dialog-confirm ${tone === 'destructive' ? 'destructive' : 'dark'}`} disabled={request.kind === 'prompt' && !value.trim()}>{request.kind === 'notice' ? 'Close' : request.options.confirmLabel}</button></footer>
      </form>
    </section>
  </div>, document.body)
}
