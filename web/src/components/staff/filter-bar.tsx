import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// Search, filters and result count for staff lists, all on one left-aligned row
// (design/StaffQueue: 36px controls, search first).
export function FilterBar({
  children,
  shown,
  total,
  noun,
  active,
  onClear,
  className,
}: {
  children: ReactNode
  shown: number
  total: number
  noun: string // "students"
  active: boolean
  onClear: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
      <span role="status" className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
        {active ? (
          <>
            <span>
              <span className="font-mono text-foreground">{shown}</span> of <span className="font-mono">{total}</span> {noun}
            </span>
            <button type="button" onClick={onClear} className="font-medium text-primary hover:underline">
              Clear filters
            </button>
          </>
        ) : (
          <span>
            <span className="font-mono">{total}</span> {noun}
          </span>
        )}
      </span>
    </div>
  )
}

export function FilterSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn('relative w-[300px]', className)}>
      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        className="h-9 w-full rounded-sm border border-input bg-card pr-8 pl-8 text-sm placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

// A filter dropdown. The first option is "no filter"; when another is chosen the control is
// highlighted so it's clear a filter is on.
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const on = value !== options[0]?.value
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn('h-9 min-w-[150px] text-sm', on && 'border-primary bg-primary-soft text-primary [&_svg]:text-primary')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
