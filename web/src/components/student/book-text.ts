// Words for a book's state, shared by the phone rows and the desktop table (design/Library, DeskLibrary).
import type { Book, ReservationOut } from '@/api/generated/model'
import { shortDate } from '@/lib/format'
import { onDay } from '@/lib/records'

export function reservationText(r: ReservationOut) {
  return r.status === 'ready' && r.collect_by
    ? `Collect from the desk by ${shortDate(onDay(r.collect_by))}`
    : 'Waiting for a copy to come back'
}

export function shelfText(b: Book) {
  if (b.copies === 0) return b.e_resource_url ? 'Online only' : 'Not available to borrow'
  return b.available > 0 ? `${b.available} on the shelf` : 'All copies on loan'
}
