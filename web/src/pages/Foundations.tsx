import { CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTheme } from '@/lib/theme'

// Reference page for tokens and primitives (design/Foundations.dc.html).
export default function Foundations() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-8 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Foundations</h1>
          <p className="text-muted-foreground">Tokens and primitives for the Campus Portal.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="dark">Dark</Label>
          <Switch id="dark" checked={resolvedTheme === 'dark'} onCheckedChange={(on) => setTheme(on ? 'dark' : 'light')} />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Continue</Button>
          <Button variant="outline">Save for later</Button>
          <Button variant="ghost">Timetable</Button>
          <Button variant="destructive">Disconnect</Button>
          <Button disabled>Submit</Button>
          <Button size="sm">Offer a place</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>Test</Badge>
          <Badge variant="urgent">in 2 days</Badge>
          <Badge variant="success">
            <CircleCheck strokeWidth={1.5} />
            Submitted
          </Badge>
          <Badge variant="info">In review</Badge>
          <Badge variant="destructive">Overdue</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Fields</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nid">National ID number</Label>
          <Input id="nid" className="font-mono" defaultValue="63-2047823 Q 29" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grade">Mathematics grade</Label>
          <p className="text-sm text-muted-foreground">We weren't sure about this one. Check it against your slip.</p>
          <Input id="grade" lowConfidence defaultValue="C" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nid-bad">National ID number</Label>
          <p className="text-sm font-medium text-destructive">That number isn't valid. Check the letter after the digits.</p>
          <Input id="nid-bad" aria-invalid className="font-mono" defaultValue="63-2047823 P 29" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Alerts</h2>
        <Alert variant="info">
          <Info strokeWidth={1.5} />
          <div>
            <AlertTitle>Scans are clearer on a phone</AlertTitle>
            <AlertDescription>You can continue on your phone at any step.</AlertDescription>
          </div>
        </Alert>
        <Alert variant="urgent">
          <TriangleAlert strokeWidth={1.5} />
          <div>
            <AlertTitle>DCN201 test on Thursday at 10:00 in Lab 3</AlertTitle>
          </div>
        </Alert>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Tabs</h2>
        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
            <TabsTrigger value="marks">Marks</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs defaultValue="upcoming">
          <TabsList variant="segmented">
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="submitted">Submitted</TabsTrigger>
            <TabsTrigger value="marked">Marked</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Identifiers</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 [&_dd]:font-mono [&_dt]:text-muted-foreground">
          <dt>Student no.</dt>
          <dd>CC/2027/0142</dd>
          <dt>Class group</dt>
          <dd>DIT-1A</dd>
          <dt>Module</dt>
          <dd>DCN201</dd>
        </dl>
      </section>
    </main>
  )
}
