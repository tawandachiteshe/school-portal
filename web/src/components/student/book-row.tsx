import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCancelReservation, useReserveBook } from '@/api/generated/library/library'
import type { Book, ReservationOut } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { onDay } from '@/lib/records'
import { invalidateStudentData } from '@/lib/student'

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`

export function ReservationStatus({ r }: { r: ReservationOut }) {
  if (r.status === 'ready') return <Badge variant="success">Ready</Badge>
  return <Badge>{r.position ? `${ordinal(r.position)} in the queue` : 'Reserved'}</Badge>
}

export function reservationText(r: ReservationOut) {
  return r.status === 'ready' && r.collect_by
    ? `Collect from the desk by ${shortDate(onDay(r.collect_by))}`
    : 'Waiting for a copy to come back'
}

// A catalogue or reading-list book with its shelf status and a Reserve action when every copy is out.
export function BookRow({ b }: { b: Book }) {
  const qc = useQueryClient()
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
  const reserve = useReserveBook({
    mutation: {
      onSuccess: () => {
        toast(`Reserved ${b.title}. It shows as Ready here when a copy is kept for you.`)
        void invalidateStudentData(qc)
      },
      onError,
    },
  })
  const cancel = useCancelReservation({
    mutation: {
      onSuccess: () => {
        toast('Reservation cancelled.')
        void invalidateStudentData(qc)
      },
      onError,
    },
  })
  const shelf =
    b.copies === 0
      ? b.e_resource_url
        ? 'Online only'
        : 'Not available to borrow'
      : b.available > 0
        ? `${b.available} on the shelf`
        : 'All copies on loan'
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <div className="font-medium">{b.title}</div>
        <div className="text-sm text-muted-foreground">{[b.authors.join(', '), b.edition].filter(Boolean).join(' · ')}</div>
        <div className="text-sm">
          {b.on_loan_to_you ? (
            <span className="text-muted-foreground">On loan to you</span>
          ) : b.reservation ? (
            reservationText(b.reservation)
          ) : (
            <>
              <span className={b.available > 0 ? 'text-success' : 'text-muted-foreground'}>{shelf}</span>
              {b.call_number && <span className="text-muted-foreground"> · shelf <span className="font-mono">{b.call_number}</span></span>}
            </>
          )}
        </div>
        {b.note && <p className="mt-1 text-sm text-muted-foreground">{b.note}</p>}
        {b.e_resource_url && (
          <a href={b.e_resource_url} className="text-sm text-primary underline underline-offset-3" rel="noreferrer" target="_blank">
            Read online
          </a>
        )}
      </div>
      {b.reservation ? (
        <div className="flex flex-col items-end gap-2">
          <ReservationStatus r={b.reservation} />
          {b.reservation.status === 'waiting' && (
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ reservationId: b.reservation!.id })}
              className="inline-flex min-h-11 items-center text-sm font-medium text-destructive"
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        !b.on_loan_to_you &&
        b.copies > 0 &&
        b.available === 0 && (
          <Button variant="outline" disabled={reserve.isPending} onClick={() => reserve.mutate({ itemId: b.id })}>
            Reserve
          </Button>
        )
      )}
    </li>
  )
}
