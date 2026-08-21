import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function safeUrl(url: string) {
  if (url.startsWith('#') || (/^(?:\.\.?\/|\/(?!\/))/.test(url))) return url
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : ''
  } catch {
    return ''
  }
}

export function MarkdownMessage({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return <div className="markdown-message">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeUrl}
      components={{
        a: ({ children: label, href, node: _node, ...props }) => href
          ? <a {...props} href={href} target="_blank" rel="noreferrer noopener">{label}</a>
          : <span>{label}</span>,
        code: ({ className, children: code, ...props }) => <code {...props} className={className}>{code}</code>,
      }}
    >{children}</ReactMarkdown>
    {streaming && <i className="summary-cursor" aria-hidden="true" />}
  </div>
}
