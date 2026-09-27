import { CircleCheck, Info, Loader2, OctagonX, TriangleAlert } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/lib/theme"

// Toasts: bottom on phones, bottom-right on desktop. Never use a toast for an error
// the user must act on — use an inline Alert instead (design-handoff.md).
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  const icon = { strokeWidth: 1.5, className: "size-5" }
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      icons={{
        success: <CircleCheck {...icon} />,
        info: <Info {...icon} />,
        warning: <TriangleAlert {...icon} />,
        error: <OctagonX {...icon} />,
        loading: <Loader2 {...icon} className="size-5 animate-spin" />,
      }}
      toastOptions={{ classNames: { toast: "!shadow-none !rounded-md !border-border !font-sans" } }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "6px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
