import { useSearchParams, Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import { useNoteDownload } from '@/components/student/use-note-download'
import { useSearchStudent } from '@/api/generated/student/student'
import { fileKind, fileSize, postedAt } from '@/lib/format'
import { useIsDesktop } from '@/lib/use-desktop'
import { DeskPage, deskH1 } from '@/components/shell/student-desktop'

function Frame({ desktop, q, children }: { desktop: boolean; q: string; children: React.ReactNode }) {
  return desktop ? (
    <DeskPage crumbs={[{ to: '/', label: 'Home' }, { label: 'Search' }]}>{children}</DeskPage>
  ) : (
    <SubPage title={`“${q}”`} back="/" backLabel="Back to home">
      <main className="flex grow flex-col gap-6 px-4 py-6">{children}</main>
    </SubPage>
  )
}

// Results for the desktop top-bar search: modules, notes and announcements.
export default function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const { data, isPending, isError } = useSearchStudent({ q }, { query: { enabled: q.length >= 2 } })
  const download = useNoteDownload()
  const now = new Date()
  const none = data && !data.modules.length && !data.notes.length && !data.announcements.length
  const desktop = useIsDesktop()
  return (
    <Frame desktop={desktop} q={q}>
        <h1 className={desktop ? deskH1 : 'text-2xl leading-8 font-semibold tracking-[-0.01em]'}>
          Results for “{q}”
        </h1>
        {q.length >= 2 && isPending && <Skeleton className="h-32" />}
        {isError && <Empty>Couldn't search. Check your connection.</Empty>}
        {none && <Empty>Nothing matches “{q}”. Try a module code such as DCN201, or fewer words.</Empty>}
        {data && data.modules.length > 0 && (
          <section aria-labelledby="s-mod">
            <h2 id="s-mod" className="border-b pb-2 text-lg leading-6 font-semibold">
              Modules
            </h2>
            <ul className="[&>li+li]:border-t">
              {data.modules.map((m) => (
                <li key={m.code}>
                  <Link to={`/modules/${m.code}`} className="flex min-h-12 items-center gap-3 py-2">
                    <span className="w-16 font-mono text-sm text-muted-foreground">{m.code}</span>
                    <span className="font-medium">{m.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && data.notes.length > 0 && (
          <section aria-labelledby="s-notes">
            <h2 id="s-notes" className="border-b pb-2 text-lg leading-6 font-semibold">
              Notes
            </h2>
            <ul className="[&>li+li]:border-t">
              {data.notes.map((n) => (
                <li key={n.id} className="flex items-center gap-3 py-2.5">
                  <Badge className="w-12 justify-center font-mono">{fileKind(n.mime_type)}</Badge>
                  <span className="grow">
                    <span className="block font-medium">{n.title}</span>
                    <span className="text-sm text-muted-foreground">
                      <span className="font-mono">{n.module_code}</span>
                      {n.week && ` · Week ${n.week}`}
                      {n.size_bytes && ` · ${fileSize(n.size_bytes)}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => download.request(n)}
                    className="text-sm text-primary underline underline-offset-3"
                  >
                    Download<span className="sr-only"> {n.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && data.announcements.length > 0 && (
          <section aria-labelledby="s-ann">
            <h2 id="s-ann" className="border-b pb-2 text-lg leading-6 font-semibold">
              Announcements
            </h2>
            <ul className="[&>li+li]:border-t">
              {data.announcements.map((a) => (
                <li key={a.id}>
                  <Link to={`/announcements/${a.id}`} className="block py-3">
                    <span className="block font-medium">{a.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {[a.from_label, postedAt(new Date(a.publish_at), now)].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      {download.sheet}
    </Frame>
  )
}
