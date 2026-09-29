import { CircleCheck } from 'lucide-react'
import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { getAssistantHomeQueryKey, useHandoffPreview, useSendToStudentAffairs } from '@/api/generated/assistant/assistant'
import type { AskHandoffOut } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'

// design/AskHandoff: the question goes to Student Affairs only when the student presses the button.
export function Handoff({ question, sessionId }: { question: string; sessionId: string }) {
  const id = useId()
  const qc = useQueryClient()
  const [text, setText] = useState(question)
  const [sent, setSent] = useState<AskHandoffOut | null>(null)
  const preview = useHandoffPreview()
  const send = useSendToStudentAffairs()
  if (sent)
    return (
      <Alert variant="success" role="status">
        <CircleCheck strokeWidth={1.5} />
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">Sent to Student Affairs</p>
          <p className="text-sm">
            Reference <span className="font-mono">{sent.reference}</span>.{' '}
            {sent.sms_to ? "We'll text you when they reply." : 'Their reply will appear in Ask Campus.'}
          </p>
        </div>
      </Alert>
    )
  const p = preview.data
  return (
    <>
      <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <h2 id={`${id}-h`} className="text-lg leading-6 font-semibold">
          Send your question to Student Affairs
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-q`}>Your question</Label>
          <textarea
            id={`${id}-q`}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-sm border border-input bg-card px-3 py-2.5"
          />
        </div>
        {p && (
          <p className="text-sm text-muted-foreground">
            They'll see your name
            {p.student_number && (
              <>
                , <span className="font-mono">{p.student_number}</span>
              </>
            )}
            {p.class_group && ' and your class'}.{' '}
            {p.sms_to ? (
              <>
                Replies come by SMS to <span className="font-mono">{p.sms_to}</span> and appear in Ask Campus.
              </>
            ) : (
              'Replies appear in Ask Campus.'
            )}
          </p>
        )}
        {send.error && <p className="font-medium text-destructive">{errorMessage(send.error, 'Couldn’t send it. Try again.')}</p>}
        <Button
          block
          disabled={send.isPending || text.trim().length < 3}
          onClick={() =>
            send.mutate(
              { data: { question: text.trim(), session_id: sessionId } },
              {
                onSuccess: (r) => {
                  setSent(r)
                  void qc.invalidateQueries({ queryKey: getAssistantHomeQueryKey() })
                },
              },
            )
          }
        >
          Send to Student Affairs
        </Button>
      </section>
      <p className="text-sm text-muted-foreground">Or visit Student Affairs in Block A.</p>
    </>
  )
}
