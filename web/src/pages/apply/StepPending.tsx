import { Link } from 'react-router'
import { ApplyShell, STEPS } from '@/components/shell/apply-shell'
import { useMyApplication } from '@/api/generated/apply/apply'

// Steps 2–5 until they're built.
export default function StepPending({ step }: { step: number }) {
  const { data: app } = useMyApplication()
  return (
    <ApplyShell step={step} app={app}>
      <main className="flex flex-col gap-3 px-4 py-6 lg:px-20 lg:py-10">
        <h1 className="text-2xl leading-8 font-semibold">{STEPS[step - 1]}</h1>
        <p className="text-muted-foreground">This step isn't available yet. Your progress so far is saved.</p>
        <Link to="/apply/programme" className="text-primary underline underline-offset-2">
          Back to programme
        </Link>
      </main>
    </ApplyShell>
  )
}
