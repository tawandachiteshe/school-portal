import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { getIntakePlacesQueryKey, useIntakePlaces, useSetIntakePlaces } from '@/api/generated/admissions/admissions'
import type { ProgrammePlaces } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { formatLongDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

// No design: places per programme for the intake, set by Admissions, against the offers made.
// "Remaining" counts offers still standing (made, not declined), accepted or not yet answered.
function PlacesCell({ p }: { p: ProgrammePlaces }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const save = useSetIntakePlaces({
    mutation: {
      onSuccess: (r) => {
        qc.setQueryData(getIntakePlacesQueryKey(), r)
        setEditing(false)
        toast(`${p.name}: ${value} places.`)
      },
      onError: (e) => toast(errorMessage(e, "Couldn't save. Try again.")),
    },
  })
  const n = Number(value)
  const ok = value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 10_000
  if (editing)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) save.mutate({ programmeId: p.programme_id, data: { places: n } })
        }}
      >
        <label htmlFor={`places-${p.programme_id}`} className="sr-only">
          Places for {p.name}
        </label>
        <Input
          id={`places-${p.programme_id}`}
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          className="h-9 w-20 font-mono"
        />
        <Button size="sm" type="submit" disabled={!ok || save.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </form>
    )
  return (
    <span className="flex items-center gap-3">
      {p.places === null || p.places === undefined ? (
        <span className="text-muted-foreground">Not set</span>
      ) : (
        <span className="font-mono">{p.places}</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setValue(p.places == null ? '' : String(p.places))
          setEditing(true)
        }}
      >
        {p.places == null ? 'Set' : 'Change'}
      </Button>
    </span>
  )
}

export default function Places() {
  const { data, isPending } = useIntakePlaces()
  return (
    <>
      <StaffTopBar left="Admissions · intake places" />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div>
          <h1 className={staffH1}>Intake places{data?.intake && ` · ${data.intake}`}</h1>
          <p className="text-sm text-muted-foreground">
            Places each programme has, against offers made.
            {data?.closes_at && ` Applications close ${formatLongDate(new Date(data.closes_at))}.`} Set the places once they're agreed.
          </p>
        </div>
        {isPending ? (
          <Skeleton className="h-48" />
        ) : data && data.programmes.length ? (
          <Table
            head={
              <>
                <th className={th}>Programme</th>
                <th className={th}>Places</th>
                <th className={cn(th, 'text-right')}>Offered</th>
                <th className={cn(th, 'text-right')}>Accepted</th>
                <th className={cn(th, 'text-right')}>Declined</th>
                <th className={cn(th, 'text-right')}>In the queue</th>
                <th className={cn(th, 'text-right')}>Remaining</th>
              </>
            }
          >
            {data.programmes.map((p) => (
              <tr key={p.programme_id}>
                <td className={td}>
                  <span className="font-medium">{p.name}</span> <span className="font-mono text-muted-foreground">{p.code}</span>
                </td>
                <td className={td}>
                  <PlacesCell p={p} />
                </td>
                <td className={cn(td, 'text-right font-mono')}>{p.offered}</td>
                <td className={cn(td, 'text-right font-mono')}>{p.accepted}</td>
                <td className={cn(td, 'text-right font-mono')}>{p.declined}</td>
                <td className={cn(td, 'text-right font-mono')}>{p.in_queue}</td>
                <td className={cn(td, 'text-right')}>
                  {p.remaining == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : p.remaining < 0 ? (
                    <span className="font-medium text-destructive">{-p.remaining} over</span>
                  ) : (
                    <span className="font-mono">{p.remaining}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-muted-foreground">No intake is open or planned.</p>
        )}
      </main>
    </>
  )
}
