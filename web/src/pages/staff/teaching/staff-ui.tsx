import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Dense staff tables (design/tcfl.css .tbl.dense): 40px rows, 14px muted headers, hairlines.
export const th = 'h-9 px-3 text-left text-sm font-medium whitespace-nowrap text-muted-foreground'
export const td = 'h-10 px-3 py-2 align-middle text-sm'

export function Table({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <table className={cn('w-full border-collapse [&_tbody_tr]:border-b [&_thead_tr]:border-b', className)}>
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

export const staffH1 = 'text-2xl leading-8 font-semibold tracking-[-0.01em]'
