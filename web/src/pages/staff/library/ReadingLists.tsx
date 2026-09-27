import { useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useId, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import {
  getReadingListsQueryKey,
  useAddToReadingList,
  useCatalogue,
  useReadingLists,
  useRemoveFromReadingList,
} from '@/api/generated/library-catalogue/library-catalogue'
import type { ModuleReadingList } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

// No design: each module's reading list this term, as students see it on the Library page.
function AddToList({ list, onClose }: { list: ModuleReadingList | null; onClose: () => void }) {
  const qc = useQueryClient()
  const id = useId()
  const [q, setQ] = useState('')
  const query = useDeferredValue(q.trim())
  const [picked, setPicked] = useState<string | null>(null)
  const [core, setCore] = useState(true)
  const [note, setNote] = useState('')
  const books = useCatalogue(query.length >= 2 ? { q: query } : undefined, { query: { enabled: !!list && query.length >= 2 } })
  const add = useAddToReadingList({
    mutation: {
      onSuccess: (r) => {
        qc.setQueryData(getReadingListsQueryKey(), r)
        toast('Added to the reading list.')
        setQ('')
        setPicked(null)
        setNote('')
        onClose()
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't add it. Try again."),
    },
  })
  const listed = new Set(list?.books.map((b) => b.item_id))
  return (
    <Dialog open={!!list} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[560px]">
        {list && (
          <>
            <DialogTitle>
              Add to <span className="font-mono">{list.module_code}</span> {list.module_name}
            </DialogTitle>
            <DialogDescription>Find the book in the catalogue. Add it there first if the library doesn't have it yet.</DialogDescription>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-q`}>Book</Label>
              <Input id={`${id}-q`} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or author" />
            </div>
            {query.length >= 2 && (
              <ul className="max-h-60 divide-y overflow-y-auto border-y" role="listbox" aria-label="Books">
                {(books.data ?? []).map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={picked === b.id}
                      disabled={listed.has(b.id)}
                      onClick={() => setPicked(b.id)}
                      className={cn(
                        'flex w-full flex-col items-start px-2 py-2 text-left text-sm',
                        picked === b.id && 'bg-primary-soft',
                        listed.has(b.id) && 'text-muted-foreground',
                      )}
                    >
                      <span className="font-medium">{b.title}</span>
                      <span className="text-muted-foreground">
                        {[b.authors.join('; '), b.edition].filter(Boolean).join(' · ')}
                        {listed.has(b.id) ? ' · already on this list' : ` · ${b.copies} ${b.copies === 1 ? 'copy' : 'copies'}`}
                      </span>
                    </button>
                  </li>
                ))}
                {books.data && books.data.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No book matches.</li>}
              </ul>
            )}
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={core} onChange={(e) => setCore(e.target.checked)} className="size-4 accent-primary" />
              Core reading (not optional)
            </label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-n`}>Note for students</Label>
              <Input id={`${id}-n`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Chapters 3 to 5" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!picked || add.isPending}
                onClick={() => picked && add.mutate({ offeringId: list.offering_id, data: { item_id: picked, is_core: core, note: note || null } })}
              >
                Add to list
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function ReadingLists() {
  const qc = useQueryClient()
  const { data, isPending } = useReadingLists()
  const [addTo, setAddTo] = useState<ModuleReadingList | null>(null)
  const remove = useRemoveFromReadingList({
    mutation: {
      onSuccess: (r) => {
        qc.setQueryData(getReadingListsQueryKey(), r)
        toast('Removed from the reading list.')
      },
    },
  })
  return (
    <>
      <StaffTopBar left="Library · reading lists" />
      <main className="flex flex-col gap-8 px-8 py-6">
        <div>
          <h1 className={staffH1}>Reading lists</h1>
          <p className="text-sm text-muted-foreground">Each module's books this term. Students see them on the Library page, with what's on the shelf.</p>
        </div>
        {isPending ? (
          <Skeleton className="h-64" />
        ) : (
          data?.map((m) => (
            <section key={m.offering_id} aria-labelledby={`rl-${m.offering_id}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <h2 id={`rl-${m.offering_id}`} className="text-lg leading-6 font-semibold">
                  <span className="font-mono">{m.module_code}</span> {m.module_name}
                  {m.class_group && <span className="font-mono text-sm font-normal text-muted-foreground"> · {m.class_group}</span>}
                </h2>
                <Button size="sm" variant="outline" onClick={() => setAddTo(m)}>
                  Add a book
                </Button>
              </div>
              {m.books.length ? (
                <Table
                  className="table-fixed"
                  head={
                    <>
                      <th className={th}>Book</th>
                      <th className={cn(th, 'w-[110px]')}>Reading</th>
                      <th className={cn(th, 'w-[240px]')}>Note</th>
                      <th className={cn(th, 'w-[120px] text-right')}>On the shelf</th>
                      <th className={cn(th, 'w-[100px]')}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </>
                  }
                >
                  {m.books.map((b) => (
                    <tr key={b.item_id}>
                      <td className={td}>
                        <span className="font-medium">{b.title}</span>{' '}
                        <span className="text-muted-foreground">{b.authors.join('; ')}</span>
                      </td>
                      <td className={td}>{b.is_core ? <Badge>Core</Badge> : <span className="text-muted-foreground">Optional</span>}</td>
                      <td className={cn(td, 'text-muted-foreground')}>{b.note ?? '—'}</td>
                      <td className={cn(td, 'text-right font-mono')}>
                        {b.available} of {b.copies}
                      </td>
                      <td className={cn(td, 'text-right')}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ offeringId: m.offering_id, itemId: b.item_id })}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No books yet.</p>
              )}
            </section>
          ))
        )}
      </main>
      <AddToList list={addTo} onClose={() => setAddTo(null)} />
    </>
  )
}
