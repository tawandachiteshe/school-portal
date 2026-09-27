import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApplyShell } from '@/components/shell/apply-shell'
import type { ProgrammeChoice } from '@/api/generated/model'
import {
  getMyApplicationQueryKey,
  useChooseProgramme,
  useMyApplication,
  useProgrammes,
} from '@/api/generated/apply/apply'
import { ApiError } from '@/lib/api'
import { useIsDesktop } from '@/lib/use-desktop'
import { cn } from '@/lib/utils'
import { applyHome, STEP_PATH } from './common'

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-card',
        on && 'border-primary after:size-2.5 after:rounded-full after:bg-primary',
      )}
    />
  )
}

// Mobile: one card per programme (design/ProgrammeMobile).
function Cards({ rows, value, onChange }: { rows: ProgrammeChoice[]; value?: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Programme" className="flex flex-col gap-3">
      {rows.map((p) => {
        const on = p.id === value
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.id)}
            className={cn(
              'grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 rounded-md border bg-card p-4 text-left',
              on && 'border-primary bg-primary-soft',
            )}
          >
            <span className="mt-0.5">
              <Radio on={on} />
            </span>
            <span className="flex flex-col gap-1">
              <span className={on ? 'font-semibold' : 'font-medium'}>{p.name}</span>
              <span className="text-sm text-muted-foreground">
                {[p.award, p.length].filter(Boolean).join(' · ')}
              </span>
              <span className="mt-1 text-sm">Entry: {p.entry}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Desktop: a table with the requirements side by side (design/ProgrammeDesktop).
function Rows({ rows, value, onChange }: { rows: ProgrammeChoice[]; value?: string; onChange: (id: string) => void }) {
  return (
    <table className="w-full border-collapse text-base [&_tbody_tr]:border-b [&_thead_tr]:border-b" role="radiogroup" aria-label="Programme">
      <thead>
        <tr className="text-left text-sm text-muted-foreground">
          <th className="w-12 px-3 py-2" />
          <th className="px-3 py-2 font-medium">Programme</th>
          <th className="px-3 py-2 font-medium">Award</th>
          <th className="px-3 py-2 font-medium">Length</th>
          <th className="px-3 py-2 font-medium">Entry requirements</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const on = p.id === value
          return (
            <tr
              key={p.id}
              role="radio"
              aria-checked={on}
              aria-label={p.name}
              tabIndex={on || (!value && p === rows[0]) ? 0 : -1}
              onClick={() => onChange(p.id)}
              onKeyDown={(e) => {
                const i = rows.indexOf(p)
                const to = e.key === 'ArrowDown' ? rows[i + 1] : e.key === 'ArrowUp' ? rows[i - 1] : null
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  onChange(p.id)
                } else if (to) {
                  e.preventDefault()
                  onChange(to.id)
                  ;(e.currentTarget.parentElement?.children[i + (e.key === 'ArrowDown' ? 1 : -1)] as HTMLElement | undefined)?.focus()
                }
              }}
              className={cn('cursor-pointer align-top hover:bg-muted/50', on && 'bg-primary-soft hover:bg-primary-soft')}
            >
              <td className="px-3 pt-3.5 pb-3">
                <Radio on={on} />
              </td>
              <td className={cn('px-3 py-3', on ? 'font-semibold' : 'font-medium')}>{p.name}</td>
              <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{p.award ?? '—'}</td>
              <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{p.length}</td>
              <td className="px-3 py-3">{p.entry}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Step 1 · Programme
export default function Programme() {
  const desktop = useIsDesktop()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: app, isPending: appPending } = useMyApplication()
  const { data: rows, isPending } = useProgrammes()
  const [picked, setPicked] = useState<string>()
  const choose = useChooseProgramme({
    mutation: {
      onSuccess: (a) => {
        qc.setQueryData(getMyApplicationQueryKey(), a)
        navigate(STEP_PATH.national_id)
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't save. Try again."),
    },
  })
  if (app && app.status !== 'draft') return <Navigate to={applyHome(app)} replace />
  const value = picked ?? app?.programme_id
  const selected = rows?.find((p) => p.id === value)
  const go = () => value && choose.mutate({ data: { programme_id: value } })

  return (
    <ApplyShell
      step={1}
      app={app}
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {selected ? (
              <>
                Selected: <span className="font-medium text-foreground">{selected.name}</span>
              </>
            ) : (
              'Choose a programme to continue'
            )}
          </span>
          <Button block disabled={!value || choose.isPending} onClick={go}>
            Continue
          </Button>
        </>
      }
    >
      <main className={cn('flex flex-col', desktop ? 'gap-6 px-20 py-10' : 'gap-4 px-4 py-6')}>
        <div className="flex max-w-[720px] flex-col gap-1">
          <h1 className={desktop ? 'text-[28px] leading-9 font-semibold tracking-[-0.015em]' : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
            Choose a programme
          </h1>
          <p className="text-muted-foreground">
            {desktop
              ? 'Check the entry requirements before you choose. You can change your programme until you submit.'
              : 'Check the entry requirements first. You can change this until you submit.'}
          </p>
        </div>
        {isPending || appPending ? (
          <Skeleton className="h-80" />
        ) : desktop ? (
          <>
            <Rows rows={rows ?? []} value={value} onChange={setPicked} />
            <div className="mt-2 flex items-center gap-6">
              <Button disabled={!value || choose.isPending} onClick={go}>
                Continue to National ID
              </Button>
              <span className="text-sm text-muted-foreground">
                Next you'll add your National ID. Your phone camera works best.
              </span>
            </div>
          </>
        ) : (
          <Cards rows={rows ?? []} value={value} onChange={setPicked} />
        )}
      </main>
    </ApplyShell>
  )
}
