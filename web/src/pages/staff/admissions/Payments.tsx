import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import type { PaymentToConfirm } from '@/api/generated/model'
import {
  getDocumentFileUrl,
  getPaymentsToConfirmQueryKey,
  useConfirmPayment,
  usePaymentsToConfirm,
  useRejectPayment,
} from '@/api/generated/admissions/admissions'
import { ApiError } from '@/lib/api'
import { formatLongDate, shortDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

const METHOD = { cash: 'Cash', bank: 'Bank transfer', ecocash: 'EcoCash', onemoney: 'OneMoney' } as const

// No design: bank transfers and cash the applicant says they've paid, for Accounts/Admissions to
// match against the bank statement or the cash book (design/PayOffice "once Accounts confirm").
export default function Payments() {
  const qc = useQueryClient()
  const { data, isPending } = usePaymentsToConfirm()
  const [open, setOpen] = useState<{ p: PaymentToConfirm; kind: 'confirm' | 'reject' } | null>(null)
  const [text, setText] = useState('')
  const id = useId()
  const done = (rows: PaymentToConfirm[], msg: string) => {
    qc.setQueryData(getPaymentsToConfirmQueryKey(), rows)
    setOpen(null)
    setText('')
    toast(msg)
  }
  const onError = (e: unknown) => toast(e instanceof ApiError ? e.message : "Couldn't save. Try again.")
  const confirm = useConfirmPayment({ mutation: { onSuccess: (r) => done(r, 'Payment confirmed. The application has been sent to Admissions.'), onError } })
  const reject = useRejectPayment({ mutation: { onSuccess: (r) => done(r, 'The applicant has been told the payment wasn’t found.'), onError } })
  const rows = data ?? []
  const now = new Date()
  return (
    <>
      <StaffTopBar left="Admissions · application fees" />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div>
          <h1 className={staffH1}>Payments to confirm</h1>
          <p className="text-sm text-muted-foreground">
            Bank transfers and cash the applicant says they've paid. Match each against the statement or cash book, using the
            reference.
          </p>
        </div>
        {isPending ? (
          <Skeleton className="h-64" />
        ) : rows.length ? (
          <Table
            head={
              <>
                <th className={th}>Reference</th>
                <th className={th}>Applicant</th>
                <th className={th}>Method</th>
                <th className={cn(th, 'text-right')}>Amount</th>
                <th className={th}>Said paid</th>
                <th className={th}>Proof</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </>
            }
          >
            {rows.map((p) => {
              const late = new Date(p.expected_by) < now
              return (
                <tr key={p.id}>
                  {/* Not in the review queue until the fee is confirmed. */}
                  <td className={cn(td, 'font-mono')}>{p.reference}</td>
                  <td className={cn(td, 'font-medium')}>{p.name}</td>
                  <td className={td}>{METHOD[p.method]}</td>
                  <td className={cn(td, 'text-right font-mono')}>US$ {p.amount}</td>
                  <td className={cn(td, 'whitespace-nowrap', late && 'font-medium text-destructive')}>
                    {shortDateTime(new Date(p.created_at))}
                    {late && ' · overdue'}
                  </td>
                  <td className={td}>
                    {p.proof_document_id ? (
                      <a href={`/api${getDocumentFileUrl(p.proof_document_id)}`} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                        Open
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    <Button variant="ghost" size="sm" onClick={() => setOpen({ p, kind: 'reject' })}>
                      Not found
                    </Button>
                    <Button size="sm" onClick={() => setOpen({ p, kind: 'confirm' })}>
                      Confirm
                    </Button>
                  </td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <p className="text-muted-foreground">Nothing to confirm. {formatLongDate(now)}.</p>
        )}
      </main>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[440px]">
          {open && (
            <>
              <DialogTitle>
                {open.kind === 'confirm' ? `Confirm US$ ${open.p.amount} from ${open.p.name}?` : `Payment for ${open.p.reference} not found?`}
              </DialogTitle>
              <DialogDescription>
                {open.kind === 'confirm'
                  ? 'The application goes to the review queue and the applicant gets an SMS with their reference.'
                  : 'The applicant sees your reason and can pay again.'}
              </DialogDescription>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{open.kind === 'confirm' ? 'Receipt or bank reference' : 'What to tell the applicant'}</Label>
                <Input id={id} value={text} onChange={(e) => setText(e.target.value)} className={open.kind === 'confirm' ? 'font-mono' : ''} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(null)}>
                  Cancel
                </Button>
                <Button
                  variant={open.kind === 'confirm' ? 'default' : 'destructive'}
                  disabled={!text.trim() || confirm.isPending || reject.isPending}
                  onClick={() =>
                    open.kind === 'confirm'
                      ? confirm.mutate({ paymentId: open.p.id, data: { receipt: text } })
                      : reject.mutate({ paymentId: open.p.id, data: { reason: text } })
                  }
                >
                  {open.kind === 'confirm' ? 'Confirm payment' : 'Tell the applicant'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
