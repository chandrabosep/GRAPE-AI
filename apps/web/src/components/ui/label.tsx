"use client"

import * as React from "react"
import { cn } from "cn"

/*
 * Labels are stamps, not sentences.
 *
 * 10px uppercase at 0.18em is the caption voice from the type scale, and it is
 * what makes a form in this system read like a boarding pass: the label names
 * the field in the quiet mechanical voice, the value answers in the loud one.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "stamp-sm flex items-center gap-2 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
