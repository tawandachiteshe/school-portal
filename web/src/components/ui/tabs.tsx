import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

// Two styles from design/tcfl.css:
//  - underline (.utabs): day/module/staff-queue tabs — 2px primary bar, 600 weight when active
//  - segmented (.seg-tabs): Deadlines filter — pills on a muted track
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />
}

const tabsListVariants = cva("", {
  variants: {
    variant: {
      underline: "flex gap-6 border-b border-border",
      segmented: "flex gap-1 rounded-md bg-muted p-1",
    },
  },
  defaultVariants: { variant: "underline" },
})

const TabsVariantContext = React.createContext<"underline" | "segmented">("underline")

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsVariantContext.Provider value={variant ?? "underline"}>
      <TabsPrimitive.List data-slot="tabs-list" className={cn(tabsListVariants({ variant }), className)} {...props} />
    </TabsVariantContext.Provider>
  )
}

const triggerClasses = {
  underline:
    "inline-flex h-11 items-center gap-1.5 text-[15px] text-muted-foreground hover:text-foreground data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-2px_0_var(--primary)]",
  segmented:
    "inline-flex h-9 flex-1 basis-0 items-center justify-center rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_0_1px_var(--border)]",
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        triggerClasses[variant],
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
