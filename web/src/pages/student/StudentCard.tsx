import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { TextLink } from '@/components/student/section'
import type { Card } from '@/api/generated/model'
import { getStudentCardQueryKey, studentCard } from '@/api/generated/records/records'
import { code128 } from '@/lib/code128'
import { dateWithYear, onDay } from '@/lib/format'
import { useIsDesktop } from '@/lib/use-desktop'
import { DeskPage, deskH1 } from '@/components/shell/student-desktop'

// The card must work with no data (design: "Saved on this phone. Works without data."), so the
// last copy is kept in this browser and shown straight away.
const KEY = 'tcfl-student-card'

function cached(): Card | undefined {
  try {
    const v = localStorage.getItem(KEY)
    return v ? (JSON.parse(v) as Card) : undefined
  } catch {
    return undefined
  }
}

// The card itself keeps fixed light colours in both themes so scanners read it (design/StudentCard).
export default function StudentCard() {
  const initial = useMemo(() => cached(), [])
  const { data: card, isError } = useQuery({
    queryKey: getStudentCardQueryKey(),
    queryFn: async ({ signal }) => {
      const c = await studentCard({ signal })
      try {
        localStorage.setItem(KEY, JSON.stringify(c))
      } catch {
        /* storage unavailable */
      }
      return c
    },
    initialData: initial,
    staleTime: 60 * 60_000,
  })
  const bars = useMemo(() => (card ? code128(card.barcode) : null), [card])
  const saved = Boolean(initial || card)
  const desktop = useIsDesktop()

  const cardView = (
    <>
        {!card && !isError && <Skeleton className="h-[330px]" />}
        {!card && isError && <p className="text-muted-foreground">Connect once to save your card on this phone.</p>}
        {card && bars && (
          <section
            aria-label={`Student card for ${card.name}`}
            className="overflow-hidden rounded-md border border-[#E2DFD9] bg-white text-[#1B1A18]"
          >
            <div className="flex items-center justify-between bg-[#0B4A8B] px-4 py-3 text-white">
              <span className="flex items-baseline gap-1.5">
                <span className="font-bold tracking-[0.02em]">TCFL</span>
                <span className="opacity-85">TelOne Centre for Learning</span>
              </span>
              <span className="text-xs font-semibold tracking-[0.06em]">STUDENT</span>
            </div>
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 p-4">
              <div
                role="img"
                aria-label={`Photo of ${card.name}`}
                className="flex h-[120px] w-24 items-end justify-center overflow-hidden rounded-sm border border-[#D6D1C8] bg-[#E7E3DC]"
              >
                {card.has_photo ? null : (
                  <svg viewBox="0 0 96 120" width="96" height="120" aria-hidden>
                    <circle cx="48" cy="46" r="20" fill="#C9C3B8" />
                    <path d="M12 120c2-26 18-38 36-38s34 12 36 38z" fill="#C9C3B8" />
                  </svg>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div>
                  <div className="text-xs text-[#5E5A53]">Name</div>
                  <div className="text-lg font-semibold">{card.name}</div>
                </div>
                <div>
                  <div className="text-xs text-[#5E5A53]">Student number</div>
                  <div className="font-mono font-medium">{card.student_number}</div>
                </div>
                <div>
                  <div className="text-xs text-[#5E5A53]">Programme</div>
                  <div className="text-sm">
                    {card.programme_name}
                    {card.class_group && (
                      <>
                        {' · '}
                        <span className="font-mono">{card.class_group}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 px-4 pb-4">
              <svg
                viewBox={`0 0 ${bars.width} 60`}
                width="100%"
                height="64"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Barcode for ${card.student_number}`}
                shapeRendering="crispEdges"
              >
                <path d={bars.d} fill="#111111" />
              </svg>
              <span className="font-mono text-xs text-[#5E5A53]">{card.barcode}</span>
            </div>
            <div className="flex justify-between border-t border-[#E2DFD9] px-4 py-2.5 text-sm">
              <span className="text-[#5E5A53]">Valid until</span>
              <span className="font-semibold">{dateWithYear(onDay(card.valid_until))}</span>
            </div>
          </section>
        )}
    </>
  )
  const notes = (
    <>
        {saved && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="size-4 text-success" strokeWidth={1.5} aria-hidden />
            {desktop ? 'Saved in this browser.' : 'Saved on this phone.'} Works without data.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Show it at the library desk and exam rooms. Turn your screen brightness up if the scanner can't read it.
        </p>
        <TextLink to="/ask?about=lost-card">Lost your plastic card?</TextLink>
    </>
  )
  if (desktop)
    return (
      <DeskPage crumbs={[{ to: '/more', label: 'Account' }, { label: 'Student card' }]}>
        <h1 className={deskH1}>Student card</h1>
        <div className="grid grid-cols-[420px_minmax(0,1fr)] items-start gap-12">
          <div>{cardView}</div>
          <div className="flex max-w-[48ch] flex-col gap-4">{notes}</div>
        </div>
      </DeskPage>
    )
  return (
    <SubPage title={<span className="font-semibold">Student card</span>} back="/more" backLabel="Back">
      <main className="flex grow flex-col gap-5 px-4 py-6">
        {cardView}
        {notes}
      </main>
    </SubPage>
  )
}
