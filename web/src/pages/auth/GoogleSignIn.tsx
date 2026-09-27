import { Button } from '@/components/ui/button'
import { useSignInOptions } from '@/api/generated/auth/auth'
import { googleSignInUrl } from '@/lib/authentik-flow'

// "Continue with Google", when Authentik has a Google source (GOOGLE_CLIENT_ID). Someone new
// becomes an applicant; a Google account with the email of an existing account signs in to it.
// `first`: above the form (sign-up), with the "or" after it.
export function GoogleSignIn({ next, first = false }: { next: string; first?: boolean }) {
  const options = useSignInOptions({ query: { staleTime: Infinity, retry: false } })
  if (!options.data?.google) return null
  const or = (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span aria-hidden className="h-px grow bg-border" />
      or
      <span aria-hidden className="h-px grow bg-border" />
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      {!first && or}
      <Button variant="outline" block asChild>
        <a href={googleSignInUrl(next)}>
          <img src="/auth/static/authentik/sources/google.svg" alt="" className="size-5" />
          Continue with Google
        </a>
      </Button>
      {first && or}
    </div>
  )
}
