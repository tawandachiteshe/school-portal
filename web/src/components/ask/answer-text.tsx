import { Fragment } from 'react'

// Answers are short Markdown: paragraphs, numbered or bulleted lists, **bold** and `codes`,
// rendered as React elements, never as HTML.
// Answers are short Markdown: paragraphs, numbered or bulleted lists, **bold** and `codes`.
// Rendered as React elements, never as HTML.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <span key={i} className="font-semibold">
            {part.slice(2, -2)}
          </span>
        ) : part.startsWith('`') && part.endsWith('`') ? (
          <span key={i} className="font-mono">
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((b) => b.trim())
        .map((block, i) => {
          const lines = block.split('\n').filter((l) => l.trim())
          if (lines.every((l) => /^\s*\d+[.)]\s/.test(l)))
            return (
              <ol key={i} className="flex flex-col gap-2">
                {lines.map((l, j) => (
                  <li key={j} className="grid grid-cols-[20px_minmax(0,1fr)] gap-1">
                    <span className="font-mono text-muted-foreground">{j + 1}</span>
                    <span>
                      <Inline text={l.replace(/^\s*\d+[.)]\s/, '')} />
                    </span>
                  </li>
                ))}
              </ol>
            )
          if (lines.every((l) => /^\s*[-*•]\s/.test(l)))
            return (
              <ul key={i} className="flex list-disc flex-col gap-2 pl-5">
                {lines.map((l, j) => (
                  <li key={j}>
                    <Inline text={l.replace(/^\s*[-*•]\s/, '')} />
                  </li>
                ))}
              </ul>
            )
          return (
            <p key={i}>
              <Inline text={lines.join(' ')} />
            </p>
          )
        })}
    </>
  )
}
