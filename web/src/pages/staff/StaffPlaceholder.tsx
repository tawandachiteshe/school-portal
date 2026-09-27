import { StaffTopBar } from '@/components/shell/staff-shell'
import { formatLongDate } from '@/lib/format'

// Landing page for staff sections that haven't been built yet.
export default function StaffPlaceholder({ context, title }: { context: string; title: string }) {
  return (
    <>
      <StaffTopBar left={context} right={formatLongDate(new Date())} />
      <main className="flex flex-col gap-2 px-8 py-6">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="text-muted-foreground">This section is not built yet.</p>
      </main>
    </>
  )
}
