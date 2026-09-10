import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2 active:translate-y-0.5 active:scale-[0.98] active:shadow-inner data-[state=open]:translate-y-0.5 data-[state=open]:shadow-inner data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=on]:translate-y-0.5 data-[state=on]:shadow-inner data-[state=on]:ring-2 data-[state=on]:ring-ring aria-[expanded=true]:translate-y-0.5 aria-[expanded=true]:shadow-inner aria-[expanded=true]:ring-2 aria-[expanded=true]:ring-ring aria-[pressed=true]:translate-y-0.5 aria-[pressed=true]:shadow-inner aria-[pressed=true]:ring-2 aria-[pressed=true]:ring-ring aria-[selected=true]:translate-y-0.5 aria-[selected=true]:shadow-inner aria-[selected=true]:ring-2 aria-[selected=true]:ring-ring",
  {
    variants: {
      variant: {
        default:
          // @replit: no hover, and add primary border
          "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 rounded-md px-3 text-xs",
        lg: "min-h-11 rounded-md px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
