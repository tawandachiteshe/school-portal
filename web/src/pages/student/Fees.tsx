import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SubPage } from '@/components/shell/sub-page'
import { Empty } from '@/components/student/section'
import { useFees } from '@/api/generated/records/records'
import { formatLongDate, shortDate } from '@/lib/format'
import { money, onDay } from '@/lib/records'
import { cn } from '@/lib/utils'

export default function Fees() {
  const { data: f, isPending, isError } = useFees()

  async function copy(ref: string) {
    try {
      await navigator.clipboard.writeText(ref)
      toast('Payment reference copied.')
    } catch {
      toast(`Your reference is ${ref}.`)
    }
  }

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
