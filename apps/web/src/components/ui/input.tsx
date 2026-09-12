import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

/*
 * Fields are a baseline, not a box.
 *
 * A filled input on this canvas reads as a lighter rectangle floating on the
 * void, which is the one thing the system forbids. So the field is transparent
 * with a hairline underline; focus swaps the underline to the violet accent
 * stroke. The full border only comes back on an invalid field, where the extra
 * weight is the message.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "border-hairline-strong text-almost-white placeholder:text-graphite focus-visible:border-signal-violet aria-invalid:border-destructive h-10 w-full min-w-0 rounded-none border-0 border-b bg-transparent px-0 py-2 text-base transition-colors outline-none disabled:pointer-events-none disabled:opacity-40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
