import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/*
 * Tags are achromatic on purpose.
 *
 * A page carries a lot of these — targeting signals, campaign status, roles —
 * and the violet is rationed to one fill and one glow per view. If badges
 * could be violet the ration would be gone by the third row, so status earns
 * its emphasis from the `live` variant's dot, which is a glow rather than a
 * fill or a border.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-4xl border border-transparent px-2.5 py-1 text-[11px] leading-none font-normal whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-wash-strong text-almost-white",
        secondary: "bg-wash text-steel [a]:hover:text-almost-white",
        outline:
          "border-hairline text-steel [a]:hover:border-almost-white/40 [a]:hover:text-almost-white",
        /*
         * The one place a violet stroke is allowed.
         *
         * DESIGN.md says violet is never a border; its own Do-rule allows "one
         * accent stroke per page", and the Refero source marks the active nav
         * item with a 1px violet border. The rule that reconciles them: violet
         * strokes mark *live* state only, once per view. Everything else that
         * wants emphasis gets weight or position instead.
         */
        live: "border-signal-violet/45 bg-signal-violet/10 text-lavender-mist",
        destructive: "border-destructive/40 text-destructive",
        ghost: "text-steel hover:bg-wash hover:text-almost-white",
        link: "text-almost-white underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
