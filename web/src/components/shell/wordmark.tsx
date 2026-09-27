export function Wordmark() {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-bold tracking-[0.02em]">TCFL</span>
      <span className="text-muted-foreground">Portal</span>
    </span>
  )
}

// design/tcfl.css .avatar — initials on muted, 1px border.
export function Initials({ initials, className = '' }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-[13px] leading-4 font-semibold ${className}`}
    >
      {initials}
    </span>
  )
}
