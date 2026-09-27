import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCancelReservation, useReserveBook } from '@/api/generated/library/library'
import type { Book, ReservationOut } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { invalidateStudentData } from '@/lib/student'
import { reservationText, shelfText } from './book-text'

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`

export function ReservationStatus({ r }: { r: ReservationOut }) {
  if (r.status === 'ready') return <Badge variant="success">Ready</Badge>
  return <Badge>{r.position ? `${ordinal(r.position)} in the queue` : 'Reserved'}</Badge>
}

// Reserve / Cancel / status for one book; used by the phone row and the desktop table.
export function BookActions({ b, compact = false }: { b: Book; compact?: boolean }) {
  const qc = useQueryClient()
  const onError = (e: unknown) => toast(errorMessage(e, 'Something went wrong. Try again.'))
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
  if (b.reservation)
    return (
      <div className="flex flex-col items-end gap-2">
        <ReservationStatus r={b.reservation} />
        {b.reservation.status === 'waiting' && (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ reservationId: b.reservation!.id })}
            className="inline-flex min-h-11 items-center text-sm font-medium text-destructive"
          >
            Cancel<span className="sr-only"> reservation of {b.title}</span>
          </button>
        )}
      </div>
    )
  if (!b.on_loan_to_you && b.copies > 0 && b.available === 0)
    return (
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled={reserve.isPending}
        onClick={() => reserve.mutate({ itemId: b.id })}
      >
        Reserve<span className="sr-only"> {b.title}</span>
      </Button>
    )
  return null
}

// A catalogue or reading-list book with its shelf status and a Reserve action when every copy is out.
export function BookRow({ b }: { b: Book }) {
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
              <span className={b.available > 0 ? 'text-success' : 'text-muted-foreground'}>{shelfText(b)}</span>
              {b.call_number && (
                <span className="text-muted-foreground">
                  {' '}
                  · shelf <span className="font-mono">{b.call_number}</span>
                </span>
              )}
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
      <BookActions b={b} />
    </li>
  )
}

// Desktop: books as a table.
export function BookTable({ books }: { books: Book[] }) {
  const th = 'py-2 pr-3 text-left text-sm font-medium text-muted-foreground'
  return (
    <table className="w-full border-collapse text-[15px] leading-[22px]">
      <thead>
        <tr className="border-b">
          <th className={th}>Book</th>
          <th className={`${th} w-[130px]`}>Shelf</th>
          <th className={`${th} w-[230px]`}>Availability</th>
          <th className={`${th} w-[150px]`}>
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {books.map((b) => (
          <tr key={b.id} className="border-b align-top">
            <td className="py-3 pr-3">
              <div className="font-medium">{b.title}</div>
              <div className="text-sm text-muted-foreground">
                {[b.authors.join(', '), b.edition, b.year].filter(Boolean).join(' · ')}
              </div>
              {b.note && <div className="mt-1 text-sm text-muted-foreground">{b.note}</div>}
            </td>
            <td className="py-3 pr-3 font-mono text-sm">{b.call_number ?? '–'}</td>
            <td className="py-3 pr-3 text-sm">
              {b.on_loan_to_you ? (
                <span className="text-muted-foreground">On loan to you</span>
              ) : b.reservation ? (
                reservationText(b.reservation)
              ) : (
                <span className={b.available > 0 ? 'text-success' : 'text-muted-foreground'}>{shelfText(b)}</span>
              )}
            </td>
            <td className="py-3 text-right">
              <BookActions b={b} compact />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
