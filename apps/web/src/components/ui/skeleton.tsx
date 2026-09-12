import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-wash-strong animate-pulse rounded-[10.8px]", className)}
      {...props}
    />
  )
}

export { Skeleton }
