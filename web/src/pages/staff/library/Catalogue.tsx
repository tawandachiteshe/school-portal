import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useDeferredValue, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { useAddBook, useAddCopy, useCatalogue } from '@/api/generated/library-catalogue/library-catalogue'
import type { CatalogueItem } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

// No design: the books the library has (docs/05 §5.9 "librarians manage the catalogue in the
// portal"). Search, add a book with its copies, add a copy to a book.
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't save. Try again.")

function Field({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      {children}
    </div>
  )
}

function AddBook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const id = useId()
  const empty = { title: '', authors: '', edition: '', year: '', isbn: '', call_number: '', barcodes: '', location: '' }
  const [f, setF] = useState(empty)
  const add = useAddBook({
    mutation: {
      onSuccess: (b) => {
        void qc.invalidateQueries({ queryKey: ['/staff/library/catalogue'] })
        toast(`Added ${b.title}, ${b.copies} ${b.copies === 1 ? 'copy' : 'copies'}.`)
        setF(empty)
        onClose()
      },
    },
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  const barcodes = f.barcodes.split(/[\s,]+/).filter(Boolean)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Add a book</DialogTitle>
        <DialogDescription>Scan or type the barcode of each copy. Students can find it straight away.</DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate({
              data: {
                title: f.title,
                authors: f.authors.split(';').map((a) => a.trim()).filter(Boolean),
                edition: f.edition || null,
                year: f.year ? Number(f.year) : null,
                isbn: f.isbn || null,
                call_number: f.call_number || null,
                copies: barcodes.map((barcode) => ({ barcode, location: f.location || null })),
              },
            })
          }}
        >
          <Field id={`${id}-t`} label="Title">
            <Input id={`${id}-t`} value={f.title} onChange={set('title')} />
          </Field>
          <Field id={`${id}-a`} label="Authors" hint="Surname, first name. Separate authors with ;">
            <Input id={`${id}-a`} value={f.authors} onChange={set('authors')} placeholder="Forouzan, Behrouz" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id={`${id}-e`} label="Edition">
              <Input id={`${id}-e`} value={f.edition} onChange={set('edition')} placeholder="5th edition" />
            </Field>
            <Field id={`${id}-y`} label="Year">
              <Input id={`${id}-y`} inputMode="numeric" value={f.year} onChange={set('year')} className="font-mono" />
            </Field>
            <Field id={`${id}-c`} label="Call number">
              <Input id={`${id}-c`} value={f.call_number} onChange={set('call_number')} className="font-mono" />
            </Field>
          </div>
          <Field id={`${id}-i`} label="ISBN">
            <Input id={`${id}-i`} value={f.isbn} onChange={set('isbn')} className="font-mono" />
          </Field>
          <Field id={`${id}-b`} label="Copies" hint="One barcode per line">
            <textarea
              id={`${id}-b`}
              rows={3}
              value={f.barcodes}
              onChange={set('barcodes')}
              className="rounded-sm border border-input bg-card px-3 py-2 font-mono text-sm"
              placeholder="TCFL-B-004520"
            />
          </Field>
          <Field id={`${id}-l`} label="Where they're shelved">
            <Input id={`${id}-l`} value={f.location} onChange={set('location')} placeholder="Shelf 4" />
          </Field>
          {add.error && <p className="font-medium text-destructive">{errText(add.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={f.title.trim().length < 2 || add.isPending}>
              Add book{barcodes.length ? ` and ${barcodes.length} ${barcodes.length === 1 ? 'copy' : 'copies'}` : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddCopy({ book, onClose }: { book: CatalogueItem | null; onClose: () => void }) {
  const qc = useQueryClient()
  const id = useId()
  const [barcode, setBarcode] = useState('')
  const [location, setLocation] = useState('')
  const add = useAddCopy({
    mutation: {
      onSuccess: (b) => {
        void qc.invalidateQueries({ queryKey: ['/staff/library/catalogue'] })
        toast(`${b.title} now has ${b.copies} copies.`)
        setBarcode('')
        onClose()
      },
    },
  })
  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[440px]">
        {book && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate({ itemId: book.id, data: { barcode, location: location || null } })
            }}
          >
            <DialogTitle>Add a copy of {book.title}</DialogTitle>
            <Field id={`${id}-b`} label="Barcode">
              <Input id={`${id}-b`} autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} className="font-mono" />
            </Field>
            <Field id={`${id}-l`} label="Where it's shelved">
              <Input id={`${id}-l`} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            {add.error && <p className="font-medium text-destructive">{errText(add.error)}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={barcode.trim().length < 3 || add.isPending}>
                Add copy
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Catalogue() {
  const [q, setQ] = useState('')
  const query = useDeferredValue(q.trim())
  const { data, isPending } = useCatalogue(query ? { q: query } : undefined)
  const [adding, setAdding] = useState(false)
  const [copyOf, setCopyOf] = useState<CatalogueItem | null>(null)
  return (
    <>
      <StaffTopBar left="Library · catalogue" />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className={staffH1}>Catalogue</h1>
            <p className="text-sm text-muted-foreground">Every book the library has, with its copies. Students search the same list.</p>
          </div>
          <Button onClick={() => setAdding(true)}>Add a book</Button>
        </div>
        <div role="search" className="relative w-[420px]">
          <label htmlFor="cat-q" className="sr-only">
            Search the catalogue
          </label>
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          <Input
            id="cat-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, author, subject, ISBN, call number or barcode"
            className="pl-9"
          />
        </div>
        {isPending ? (
          <Skeleton className="h-64" />
        ) : data && data.length ? (
          <Table
            head={
              <>
                <th className={th}>Book</th>
                <th className={th}>Call number</th>
                <th className={cn(th, 'text-right')}>Copies</th>
                <th className={cn(th, 'text-right')}>On the shelf</th>
                <th className={cn(th, 'text-right')}>On loan</th>
                <th className={cn(th, 'text-right')}>Reserved</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </>
            }
          >
            {data.map((b) => (
              <tr key={b.id} className="align-top">
                <td className={cn(td, 'min-w-[380px]')}>
                  <span className="block font-medium">{b.title}</span>
                  <span className="block text-muted-foreground">{[b.authors.join('; '), b.edition, b.year].filter(Boolean).join(' · ')}</span>
                  {b.barcodes.length > 0 && <span className="font-mono text-xs leading-5 text-muted-foreground">{b.barcodes.join(', ')}</span>}
                </td>
                <td className={cn(td, 'font-mono whitespace-nowrap')}>{b.call_number ?? '—'}</td>
                <td className={cn(td, 'text-right font-mono')}>{b.copies}</td>
                <td className={cn(td, 'text-right font-mono', b.copies > 0 && b.available === 0 && 'text-muted-foreground')}>{b.available}</td>
                <td className={cn(td, 'text-right font-mono')}>{b.on_loan}</td>
                <td className={cn(td, 'text-right font-mono')}>{b.reservations_waiting}</td>
                <td className={cn(td, 'text-right')}>
                  <Button size="sm" variant="ghost" onClick={() => setCopyOf(b)}>
                    Add copy
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-muted-foreground">{query ? `Nothing matches “${query}”.` : 'The catalogue is empty.'}</p>
        )}
      </main>
      <AddBook open={adding} onClose={() => setAdding(false)} />
      <AddCopy book={copyOf} onClose={() => setCopyOf(null)} />
    </>
  )
}
