import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffTopBar } from '@/components/shell/staff-shell'
import { useMarking } from '@/api/generated/teaching/teaching'
import { calendarDaysBetween, onDay, shortDate } from '@/lib/format'
import { KIND_LABEL } from '@/lib/student'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { staffH1, Table, td, th } from './staff-ui'

// Everything that has been sat or handed in, most urgent marking first.
export default function Marking() {
  const { data, isPending } = useMarking()
  const now = useNow()
  return (
    <>
      <StaffTopBar left="Teaching" />
      <main className="flex flex-col gap-5 px-8 py-6">
        <h1 className={staffH1}>Marking</h1>
        {isPending && <Skeleton className="h-40" />}
        {data &&
          (data.length ? (
            <Table
              head={
                <>
                  <th className={cn(th, 'w-[110px]')}>Type</th>
                  <th className={th}>Assessment</th>
                  <th className={cn(th, 'w-[100px]')}>Class</th>
                  <th className={cn(th, 'w-[130px]')}>Marked</th>
                  <th className={cn(th, 'w-[180px]')}>Marks due</th>
                  <th className={cn(th, 'w-[140px]')}>
                    <span className="sr-only">Action</span>
                  </th>
                </>
              }
            >
              {data.map((m) => {
                const days = m.marks_due_on ? calendarDaysBetween(now, onDay(m.marks_due_on)) : null
                const urgent = !m.released && days !== null && days <= 1
                return (
                  <tr key={m.assessment_id} className={cn(m.released && 'text-muted-foreground')}>
                    <td className={td}>
                      <Badge>{KIND_LABEL[m.kind]}</Badge>
                    </td>
                    <td className={cn(td, !m.released && 'font-medium')}>
                      <span className="font-mono">{m.module_code}</span> {m.title}
                    </td>
                    <td className={cn(td, 'font-mono')}>{m.class_group}</td>
                    <td className={cn(td, 'font-mono')}>
                      {m.marked + m.absent}/{m.students}
                    </td>
                    <td className={td}>
                      {m.released ? (
                        'Published'
                      ) : m.marks_due_on ? (
                        urgent ? (
                          <Badge variant="urgent">{days! < 0 ? 'overdue' : days === 0 ? 'due today' : 'due tomorrow'}</Badge>
                        ) : (
                          shortDate(onDay(m.marks_due_on))
                        )
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/staff/teaching/assessments/${m.assessment_id}/marks`}>
                          {m.released ? 'View' : m.marked + m.absent ? 'Continue' : 'Enter marks'}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </Table>
          ) : (
            <p className="text-muted-foreground">Nothing to mark yet. Tests appear here once they've been sat.</p>
          ))}
      </main>
    </>
  )
}
