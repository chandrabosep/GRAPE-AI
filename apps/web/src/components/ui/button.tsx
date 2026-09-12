import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/*
 * The system has four buttons and two radii, and that is the whole set.
 *
 *   default  — the violet fill. One per view, on the action the view exists
 *              for. This is the only element on the page allowed to be violet
 *              and filled at the same time.
 *   outline  — near-black on near-black with a 1px white border. The border
 *              does all the work; the button is almost the same colour as the
 *              page it sits on, which is the point.
 *   secondary— the compact outlined control, 6px radius, for toolbars and
 *              table rows. Lighter density than `outline`.
 *   pill     — the soft-wash pill, 1584px radius. Secondary actions inside
 *              cards, where a hard-edged control would fight the card.
 *
 * Nothing here casts a shadow. Separation is line weight, everywhere.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-button bg-primary text-primary-foreground font-medium hover:bg-[color-mix(in_srgb,var(--color-signal-violet)_85%,white)]",
        outline:
          "rounded-button border-almost-white/70 bg-near-black text-almost-white hover:border-almost-white hover:bg-wash aria-expanded:bg-wash",
        secondary:
          "rounded-control border-hairline-strong bg-wash-strong text-almost-white hover:border-almost-white/60 hover:bg-[rgba(247,249,250,0.14)] aria-expanded:bg-[rgba(247,249,250,0.14)]",
        pill: "rounded-pill bg-wash-glass text-almost-white hover:bg-[rgba(237,195,196,0.11)]",
        ghost:
          "rounded-control text-steel hover:bg-wash hover:text-almost-white aria-expanded:bg-wash aria-expanded:text-almost-white",
        /* Error is text and stroke only. The system never shows a red area. */
        destructive:
          "rounded-button border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive/10",
        link: "rounded-none text-almost-white underline-offset-4 hover:underline",
      },
      size: {
        /* 16px all-round padding is the source's own spec for the filled
           action; at a 36px control height that lands as h-9 / px-4. */
        default: "h-9 gap-2 px-4 text-sm",
        xs: "h-6 gap-1 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-6 text-[15px]",
        /* The hero pill: 20px/32px, exactly as specified. */
        pill: "gap-2.5 px-8 py-5 text-sm",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
