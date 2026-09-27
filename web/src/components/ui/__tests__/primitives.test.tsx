import { render, screen } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

describe('design primitives', () => {
  it('renders a 44px primary button by default', () => {
    render(<Button>Continue</Button>)
    const btn = screen.getByRole('button', { name: 'Continue' })
    expect(btn).toHaveClass('h-11', 'bg-primary')
  })

  it('uses the urgent badge only when asked', () => {
    render(
      <>
        <Badge>Test</Badge>
        <Badge variant="urgent">in 2 days</Badge>
      </>,
    )
    expect(screen.getByText('Test')).not.toHaveClass('text-urgent')
    expect(screen.getByText('in 2 days')).toHaveClass('text-urgent')
  })

  it('marks low-confidence scanned fields', () => {
    render(<Input aria-label="Grade" lowConfidence defaultValue="C" />)
    expect(screen.getByLabelText('Grade')).toHaveAttribute('data-low-confidence', 'true')
  })
})
