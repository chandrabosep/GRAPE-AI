import * as React from "react"
import { cn } from "cn"

/*
 * A card here is a hairline and a radius, not a fill and a shadow.
 *
 * `--card` is transparent, so the void shows through and a card laid over the
 * hero's atmosphere reads as frosted glass rather than as a hole punched in
 * the sky. The 19.2px radius is the system's single card radius.
 *
 * `wash` adds the faint neutral surface for the cases where a card genuinely
 * needs to read as a raised object — a result panel, a modal body — and
 * `glass` adds the pink wash the hero's boarding pass uses.
 */
function Card({
  className,
  size = "default",
  surface = "none",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  surface?: "none" | "wash" | "glass"
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card rounded-card border-hairline text-card-foreground flex flex-col gap-(--card-spacing) border py-(--card-spacing) text-sm [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)]",
        surface === "wash" && "bg-wash",
        surface === "glass" && "bg-wash-glass",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-almost-white text-[17px] leading-snug font-normal tracking-[-0.01em] group-data-[size=sm]/card:text-[15px]",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-steel text-sm leading-relaxed", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "border-hairline mt-(--card-spacing) flex items-center border-t px-(--card-spacing) pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
