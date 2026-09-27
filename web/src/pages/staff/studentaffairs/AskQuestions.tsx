import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import type { InboxQuestion } from '@/api/generated/model'
import { getAskQuestionsInboxQueryKey, useAskQuestionsInbox, useReplyToQuestion } from '@/api/generated/assistant/assistant'
import { ApiError } from '@/lib/api'
import { shortDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from '../teaching/staff-ui'

// No design: the questions students send from Ask TCFL (design/AskHandoff "Send to Student Affairs"),
// waiting ones first. A reply is texted to the student and shown in their Ask TCFL.
export default function AskQuestions() {
  const qc = useQueryClient()
  const id = useId()
  const { data, isPending } = useAskQuestionsInbox()
  const [open, setOpen] = useState<InboxQuestion | null>(null)
  const [text, setText] = useState('')
  const reply = useReplyToQuestion({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAskQuestionsInboxQueryKey() })
        setOpen(null)
        setText('')
        toast('Reply sent. The student gets an SMS and sees it in Ask TCFL.')
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : "Couldn't send it. Try again."),
    },
  })
  const rows = data ?? []
  const waiting = rows.filter((q) => !q.reply).length
  return (
    <>
      <StaffTopBar left="Student Affairs · Ask TCFL" />
      <main className="flex flex-col gap-4 px-8 py-6">
        <div>
          <h1 className={staffH1}>Questions from Ask TCFL</h1>
          <p className="text-sm text-muted-foreground">
            Questions the assistant couldn't answer, sent on by the student. {waiting ? `${waiting} waiting for a reply.` : 'All answered.'}
          </p>
        </div>
        {isPending ? (
          <Skeleton className="h-64" />
        ) : rows.length ? (
          <Table
            head={
              <>
                <th className={th}>Reference</th>
                <th className={th}>Student</th>
                <th className={th}>Question</th>
                <th className={th}>Sent</th>
                <th className={th}>Reply</th>
              </>
            }
          >
            {rows.map((q) => (
              <tr key={q.id} className="align-top">
                <td className={cn(td, 'font-mono whitespace-nowrap')}>{q.reference}</td>
                <td className={cn(td, 'whitespace-nowrap')}>
                  <span className="block font-medium">{q.name}</span>
                  {q.student_number && (
                    <span className="text-muted-foreground">
                      <span className="font-mono">{q.student_number}</span>
                      {q.class_group && <> · <span className="font-mono">{q.class_group}</span></>}
                    </span>
                  )}
                </td>
                <td className={cn(td, 'max-w-[420px]')}>{q.question}</td>
                <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{shortDateTime(new Date(q.created_at))}</td>
                <td className={cn(td, 'max-w-[320px]')}>
                  {q.reply ? (
                    <>
                      <span className="block">{q.reply}</span>
                      <span className="text-muted-foreground">
                        {q.replied_by}
                        {q.replied_at && `, ${shortDateTime(new Date(q.replied_at))}`}
                      </span>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setOpen(q)}>
                      Reply
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-muted-foreground">No questions yet.</p>
        )}
      </main>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[520px]">
          {open && (
            <>
              <DialogTitle>Reply to {open.name}</DialogTitle>
              <DialogDescription>{open.question}</DialogDescription>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={id}>Your reply</Label>
                <textarea
                  id={id}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="rounded-sm border border-input bg-card px-3 py-2.5"
                />
                <span className="text-sm text-muted-foreground">The student gets an SMS saying you've replied, and reads it in Ask TCFL.</span>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(null)}>
                  Cancel
                </Button>
                <Button disabled={text.trim().length < 2 || reply.isPending} onClick={() => reply.mutate({ questionId: open.id, data: { reply: text.trim() } })}>
                  Send reply
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
