import * as React from "react"
import { cn } from "cn"

/* Same rule as Input: a hairline underline, not a filled box. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-hairline-strong text-almost-white placeholder:text-graphite focus-visible:border-signal-violet aria-invalid:border-destructive field-sizing-content flex min-h-20 w-full rounded-none border-0 border-b bg-transparent px-0 py-2 text-base leading-relaxed transition-colors outline-none disabled:opacity-40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
