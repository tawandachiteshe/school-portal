import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TodayClass } from '@/lib/student'
import { TodayTimeline } from './today-timeline'

const cls = (code: string, name: string, start: string, end: string, extra: Partial<TodayClass> = {}): TodayClass => ({
  module_code: code,
  module_name: name,
  kind: 'lecture',
  starts_at: `2027-03-11T${start}:00+02:00`,
  ends_at: `2027-03-11T${end}:00+02:00`,
  venue: 'Lab 3',
  lecturer: 'Eng. F. Chikore',
  cancelled: false,
  change_reason: null,
  assessment_title: null,
  ...extra,
})

// design/Main at 09:40 on Thursday 11 March.
const classes = [
  cls('MTH110', 'Engineering Mathematics', '08:00', '09:30', { venue: 'Lecture Room B2', lecturer: 'Dr S. Ncube' }),
  cls('DCN201', 'Data Communications', '10:00', '11:30', { assessment_title: 'Test 1: Signals and modulation' }),
  cls('NET202', 'Computer Networks', '12:00', '13:30', { lecturer: 'Mrs R. Ndlovu' }),
]

describe('TodayTimeline', () => {
  it('marks finished classes and highlights the next one', () => {
    render(<TodayTimeline classes={classes} now={new Date('2027-03-11T09:40:00+02:00')} />)
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText(/Finished/)).toBeInTheDocument()
    expect(items[1]).toHaveAttribute('aria-current', 'true')
    expect(within(items[1]).getByText('Next · starts in 20 min')).toBeInTheDocument()
    expect(within(items[1]).getByText('Test 1 · Lab 3 · Eng. F. Chikore')).toBeInTheDocument()
    expect(within(items[2]).getByText('Lab 3 · Mrs R. Ndlovu')).toBeInTheDocument()
  })

  it('says how long the current class has left', () => {
    render(<TodayTimeline classes={classes} now={new Date('2027-03-11T12:30:00+02:00')} />)
    expect(screen.getByText('Now · ends in 1 h')).toBeInTheDocument()
  })
})
