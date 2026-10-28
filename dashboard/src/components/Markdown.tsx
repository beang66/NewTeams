import ReactMarkdown from 'react-markdown'

const RAW_LINK = /^(?:\.\.\/)?raw\/events\.jsonl#(msg-\d+)$/

/** Agent-written Markdown. Raw HTML is dropped; links to the event log select that event instead of navigating. */
export function Markdown({ source, onRawLink }: { source: string; onRawLink?: (eventId: string) => void }) {
  return (
    <div className="md">
      <ReactMarkdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => {
            const raw = href ? RAW_LINK.exec(href) : null
            if (raw) {
              const id = raw[1]!
              return (
                <a href="#" rel="noreferrer" onClick={(e) => { e.preventDefault(); onRawLink?.(id) }}>{children}</a>
              )
            }
            return <a href={href} rel="noreferrer" target="_blank">{children}</a>
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
