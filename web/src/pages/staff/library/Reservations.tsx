import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { useReservations } from '@/api/generated/library-desk/library-desk'
import { formatLongDate, onDay, shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

// No design yet: a dense list in the style of design/LibraryOverdue. Ready (kept at the desk) first.
export default function Reservations() {
  const { data, isPending } = useReservations()
  const ready = data?.filter((r) => r.status === 'ready').length ?? 0
  const waiting = (data?.length ?? 0) - ready
  return (
    <>
      <StaffTopBar left={formatLongDate(new Date())} />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div>
          <h1 className={staffH1}>Reservations</h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.length ? `${ready} kept at the desk · ${waiting} waiting for a copy` : 'No open reservations.'}
            </p>
          )}
        </div>
        {isPending ? (
          <Skeleton className="h-64" />
        ) : (
          !!data?.length && (
            <Table
              head={
                <>
                  <th className={th}>Book</th>
                  <th className={th}>Student</th>
                  <th className={th}>Student no.</th>
                  <th className={th}>Reserved</th>
                  <th className={th}>Status</th>
                  <th className={th}>Copy</th>
                </>
              }
            >
              {data.map((r) => (
                <tr key={r.id}>
                  <td className={cn(td, 'font-medium')}>{r.title}</td>
                  <td className={td}>{r.name}</td>
                  <td className={cn(td, 'font-mono')}>{r.number ?? '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{shortDate(new Date(r.created_at))}</td>
                  <td className={td}>
                    {r.status === 'ready' ? (
                      <Badge variant="info">
                        Ready{r.collect_by && `, collect by ${shortDate(onDay(r.collect_by))}`}
                      </Badge>
                    ) : (
                      <Badge>Waiting</Badge>
                    )}
                  </td>
                  <td className={cn(td, 'font-mono', !r.barcode && 'text-muted-foreground')}>{r.barcode ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )
        )}
      </main>
    </>
  )
}
