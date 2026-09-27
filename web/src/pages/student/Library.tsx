import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleAlert, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { BookRow, ReservationStatus, reservationText } from '@/components/student/book-row'
import { Empty } from '@/components/student/section'
import { useLibraryHome, useReadingList, useRenewLoan, useSearchCatalogue } from '@/api/generated/library/library'
import type { LoanOut } from '@/api/generated/model'
import { ApiError } from '@/lib/api'
import { shortDate } from '@/lib/format'
import { invalidateStudentData } from '@/lib/student'

const list = '[&>li+li]:border-t'

function SearchBox({ initial = '' }: { initial?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initial)
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim().length >= 2) navigate(`/library/search?q=${encodeURIComponent(q.trim())}`)
      }}
      className="relative"
    >
      <label htmlFor="q" className="sr-only">
        Search the catalogue
      </label>
      <Search className="pointer-events-none absolute top-3 left-3 size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <Input
        id="q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Title, author or module code"
        className="pl-10"
        enterKeyHint="search"
      />
    </form>
  )
}

function LoanRow({ l, onRenew, busy }: { l: LoanOut; onRenew: () => void; busy: boolean }) {
  const due = new Date(l.due_at)
  const byline = [l.authors[0], l.edition].filter(Boolean).join(' · ')
  if (l.overdue)
    return (
      <li className="flex flex-col gap-2 py-3">
        <div>
          <div className="font-medium">{l.title}</div>
          <div className="text-sm text-muted-foreground">{byline}</div>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <CircleAlert className="size-4" strokeWidth={1.5} aria-hidden />
          Overdue since {shortDate(due)}
        </div>
        <p className="text-sm text-muted-foreground">
          Overdue books can't be renewed online. Return it to the desk, or ask there if you still need it.
        </p>
      </li>
    )
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 grow">
        <div className="font-medium">{l.title}</div>
        <div className="text-sm text-muted-foreground">
          {[l.authors[0], `Due ${shortDate(due)}`].filter(Boolean).join(' · ')}
        </div>
        <div className="text-sm text-muted-foreground">
          {l.renewals_left ? `${l.renewals_left} of ${l.renewals_max} renewals left` : 'No renewals left'}
        </div>
      </div>
      {l.renewals_left > 0 && (
        <Button variant="outline" onClick={onRenew} disabled={busy}>
          Renew
        </Button>
      )}
    </li>
  )
}

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="border-b pb-2 text-lg leading-6 font-semibold">
      {children}
    </h2>
  )
}

export default function Library() {
  const { data: h, isPending, isError } = useLibraryHome()
  const qc = useQueryClient()
  const renew = useRenewLoan({
    mutation: {
      onSuccess: (r) => {
        toast(`Renewed. Due back ${shortDate(new Date(r.due_at))}.`)
        void invalidateStudentData(qc)
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not renew. Try again.'),
    },
  })
  return (
    <main className="flex grow flex-col gap-7 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Library</h1>
        {h && (
          <p className="text-sm text-muted-foreground">
            {h.location} · {h.today ? `open today until ${h.today.closes}` : 'closed today'}
          </p>
        )}
      </div>
      <SearchBox />
      {isPending && <Skeleton className="h-40" />}
      {isError && <Empty>Couldn't load the library. Check your connection.</Empty>}
      {h && (
        <>
          <section aria-labelledby="h-loans">
            <Heading id="h-loans">On loan · {h.loans.length}</Heading>
            {h.loans.length ? (
              <ul className={list}>
                {h.loans.map((l) => (
                  <LoanRow key={l.id} l={l} busy={renew.isPending} onRenew={() => renew.mutate({ loanId: l.id })} />
                ))}
              </ul>
            ) : (
              <p className="pt-3 text-muted-foreground">
                No books on loan. Show your student card at the desk in {h.location} to borrow.
              </p>
            )}
          </section>

          {h.reservations.length > 0 && (
            <section aria-labelledby="h-res">
              <Heading id="h-res">Reserved · {h.reservations.length}</Heading>
              <ul className={list}>
                {h.reservations.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 grow">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-sm text-muted-foreground">{r.authors[0]}</div>
                      <div className="mt-1 text-sm">{reservationText(r)}</div>
                    </div>
                    <ReservationStatus r={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {h.reading_lists.length > 0 && (
            <section aria-labelledby="h-lists">
              <Heading id="h-lists">Reading lists</Heading>
              <ul className={list}>
                {h.reading_lists.map((r) => (
                  <li key={r.module_code}>
                    <Link to={`/library/lists/${r.module_code}`} className="flex items-center gap-3 py-3">
                      <span className="w-14 font-mono text-sm text-muted-foreground">{r.module_code}</span>
                      <span className="grow">
                        {r.books} {r.books === 1 ? 'book' : 'books'} ·{' '}
                        {r.on_shelf === 0 ? 'none' : r.on_shelf} on the shelf
                      </span>
                      <ChevronRight className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}

export function LibrarySearch() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const { data, isPending, isError } = useSearchCatalogue({ q }, { query: { enabled: q.length >= 2 } })
  return (
    <SubPage title={<span className="font-semibold">Search the catalogue</span>} back="/library" backLabel="Back to library">
      <main className="flex grow flex-col gap-4 px-4 py-6">
        <SearchBox key={q} initial={q} />
        {q.length >= 2 && isPending && <Skeleton className="h-24" />}
        {isError && <Empty>Couldn't search. Check your connection.</Empty>}
        {data &&
          (data.books.length ? (
            <>
              <p className="text-sm text-muted-foreground">
                {data.books.length} {data.books.length === 1 ? 'result' : 'results'} for “{data.query}”
              </p>
              <ul className={`border-y ${list}`}>
                {data.books.map((b) => (
                  <BookRow key={b.id} b={b} />
                ))}
              </ul>
            </>
          ) : (
            <Empty>No books match “{data.query}”. Try the author's surname or a module code.</Empty>
          ))}
      </main>
    </SubPage>
  )
}

export function ReadingListPage() {
  const { code = '' } = useParams()
  const { data, isPending, error } = useReadingList(code)
  return (
    <SubPage title={code.toUpperCase()} mono back="/library" backLabel="Back to library">
      <main className="flex grow flex-col gap-4 px-4 py-6">
        {isPending && <Skeleton className="h-32" />}
        {error && <Empty>{error instanceof ApiError ? error.message : "Couldn't load this reading list."}</Empty>}
        {data && (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Reading list</h1>
              <p className="text-muted-foreground">{data.module_name}</p>
            </div>
            <ul className={`border-y ${list}`}>
              {data.books.map((b) => (
                <BookRow key={b.id} b={b} />
              ))}
            </ul>
          </>
        )}
      </main>
    </SubPage>
  )
}
