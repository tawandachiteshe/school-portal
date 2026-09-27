import { useMe } from '@/lib/auth'
import { formatLongDate, greeting } from '@/lib/format'

export default function Home() {
  const { data: me } = useMe()
  const now = new Date()
  const week = me?.term?.week ? ` · Week ${me.term.week} of ${me.term.weeks}` : ''
  return (
    <main className="flex flex-col gap-8 px-4 pt-6 pb-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
          {greeting(now)}, {me?.given_name}
        </h1>
        <p className="text-muted-foreground">
          {formatLongDate(now)}
          {week}
        </p>
      </div>
    </main>
  )
}
