import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import type { Fees as FeesData } from '@/api/generated/model'
import { useFees } from '@/api/generated/records/records'
import { ClassContext, DeskBar } from '@/components/shell/student-desktop'
import { useIsDesktop } from '@/lib/use-desktop'
import { formatLongDate, shortDate } from '@/lib/format'
import { money, onDay } from '@/lib/records'
import { cn } from '@/lib/utils'

async function copy(ref: string) {
  try {
    await navigator.clipboard.writeText(ref)
    toast('Payment reference copied.')
  } catch {
    toast(`Your reference is ${ref}.`)
  }
}

const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Harare' })

// On a computer (no design): statement table beside the balance and how to pay.
function FeesDesk({ f }: { f: FeesData }) {
  const th = 'py-2 pr-3 text-left text-sm font-medium text-muted-foreground'
  return (
    <>
      <DeskBar left={<ClassContext />} />
      <main className="flex max-w-[1040px] flex-col gap-6 p-8">
        <div className="flex items-end justify-between gap-6">
          <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.015em]">Fees</h1>
          <Button variant="outline" asChild>
            <a href="/api/student/fees/statement.pdf">
              <Download strokeWidth={1.5} />
              Statement (PDF)
            </a>
          </Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-12">
          <section aria-labelledby="fd-stmt">
            <h2 id="fd-stmt" className="pb-2 text-lg leading-6 font-semibold">
              Statement{f.term_name ? ` · ${f.term_name}` : ''}
            </h2>
            <table className="w-full border-collapse text-[15px] leading-[22px]">
              <thead>
                <tr className="border-b">
                  <th className={`${th} w-[130px]`}>Date</th>
                  <th className={th}>Description</th>
                  <th className={`${th} w-[140px]`}>Receipt</th>
                  <th className={`${th} w-[120px] text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {f.lines.map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2.5 pr-3">{fullDate.format(onDay(l.occurred_on))}</td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{l.description}</div>
                      <div className="text-sm text-muted-foreground">{l.kind === 'payment' ? 'Payment received' : 'Charge'}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-sm">{l.receipt_ref ?? <span className="text-muted-foreground">–</span>}</td>
                    <td className={cn('py-2.5 text-right font-mono', Number(l.amount) < 0 && 'text-success')}>{money(l.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2.5 pr-3 font-semibold" colSpan={3}>
                    Balance
                  </td>
                  <td className="py-2.5 text-right font-mono font-semibold">{money(f.balance)}</td>
                </tr>
              </tbody>
            </table>
            <p className="pt-2 text-xs text-muted-foreground">All amounts in US dollars.</p>
          </section>

          <aside className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 rounded-md border bg-card p-4">
              <p className="text-sm text-muted-foreground">Balance{f.term_name ? ` for ${f.term_name}` : ''}</p>
              <p className="font-mono text-[32px] leading-10 font-semibold">US$ {money(f.balance)}</p>
              {f.next_payment ? (
                <p className="text-sm">
                  Next payment:{' '}
                  <span className="font-semibold">
                    US$ {money(f.next_payment.amount)} by {formatLongDate(onDay(f.next_payment.due_on))}
                  </span>
                </p>
              ) : (
                Number(f.balance) <= 0 && <p className="text-sm">Nothing to pay right now.</p>
              )}
            </div>
            <section aria-labelledby="fd-how" className="flex flex-col gap-2">
              <h2 id="fd-how" className="font-semibold">
                How to pay
              </h2>
              <p className="text-sm text-muted-foreground">
                {f.payment_options ?? 'Ask the Accounts Office in Block A how to pay.'}
              </p>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
                <div>
                  <div className="text-sm text-muted-foreground">Payment reference</div>
                  <div className="font-mono text-lg font-semibold select-all">{f.payment_reference}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => copy(f.payment_reference)}>
                  Copy
                </Button>
              </div>
            </section>
            <p className="text-sm text-muted-foreground">
              Payment not showing? It can take 2 working days. Accounts Office, Block A.
            </p>
          </aside>
        </div>
      </main>
    </>
  )
}

export default function Fees() {
  const { data: f, isPending, isError } = useFees()
  const desktop = useIsDesktop()
  if (desktop && f) return <FeesDesk f={f} />

  return (
    <SubPage title={<span className="font-semibold">Fees</span>} back="/more" backLabel="Back">
      <main className="flex grow flex-col gap-6 px-4 py-6">
        {isPending && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-32" />
          </div>
        )}
        {isError && <Empty>Couldn't load your fees. Check your connection.</Empty>}
        {f && (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">Balance{f.term_name ? ` for ${f.term_name}` : ''}</p>
              <p className="font-mono text-[32px] leading-10 font-semibold">US$ {money(f.balance)}</p>
              {f.next_payment ? (
                <p>
                  Next payment:{' '}
                  <span className="font-semibold">
                    US$ {money(f.next_payment.amount)} by {formatLongDate(onDay(f.next_payment.due_on))}
                  </span>
                </p>
              ) : Number(f.balance) <= 0 ? (
                <p>Nothing to pay right now.</p>
              ) : null}
            </div>

            <section aria-labelledby="h-how" className="flex flex-col gap-2">
              <h2 id="h-how" className="text-lg leading-6 font-semibold">
                How to pay
              </h2>
              <p className="text-muted-foreground">
                {f.payment_options ?? 'Ask the Accounts Office in Block A how to pay.'}
              </p>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
                <div>
                  <div className="text-sm text-muted-foreground">Use this as your payment reference</div>
                  <div className="font-mono text-lg font-semibold">{f.payment_reference}</div>
                </div>
                <Button variant="outline" size="sm" className="h-11" onClick={() => copy(f.payment_reference)}>
                  Copy
                </Button>
              </div>
            </section>

            <section aria-labelledby="h-stmt">
              <h2 id="h-stmt" className="border-b pb-2 text-lg leading-6 font-semibold">
                Statement
              </h2>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {f.lines.map((l, i) => {
                    const d = shortDate(onDay(l.occurred_on))
                    return (
                      <tr key={i} className="border-b">
                        <td className="py-3">
                          <div className="font-medium">{l.description}</div>
                          <div className="text-muted-foreground">
                            {l.kind === 'payment' ? 'Received' : 'Charged'} {d}
                            {l.receipt_ref && (
                              <>
                                {' · receipt '}
                                <span className="font-mono">{l.receipt_ref}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className={cn('py-3 text-right font-mono', Number(l.amount) < 0 && 'text-success')}>
                          {money(l.amount)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td className="py-3 font-semibold">Balance</td>
                    <td className="py-3 text-right font-mono font-semibold">{money(f.balance)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">All amounts in US dollars.</p>
            </section>

            <div className="mt-auto flex flex-col gap-3">
              <Button variant="outline" block asChild>
                <a href="/api/student/fees/statement.pdf">
                  <Download strokeWidth={1.5} />
                  Download statement (PDF)
                </a>
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Payment not showing? It can take 2 working days. Accounts Office, Block A.
              </p>
            </div>
          </>
        )}
      </main>
    </SubPage>
  )
}
