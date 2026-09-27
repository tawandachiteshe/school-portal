import { Link } from 'react-router'

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-[390px] flex-col gap-2 px-4 py-12">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">Page not found</h1>
      <p className="text-muted-foreground">The link may be out of date.</p>
      <Link className="text-primary underline underline-offset-3" to="/">
        Go to the portal home
      </Link>
    </main>
  )
}
