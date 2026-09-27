import type { ReactNode } from 'react'
import { Link } from 'react-router'

// Dashboard section: h2 with an optional text link on the right, then content.
export function Section({
  id,
  title,
  link,
  children,
}: {
  id: string
  title: string
  link?: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-center justify-between">
        <h2 id={id} className="text-lg leading-6 font-semibold">
          {title}
        </h2>
        {link && <TextLink to={link.to}>{link.label}</TextLink>}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  )
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
      {children}
    </Link>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>
}
