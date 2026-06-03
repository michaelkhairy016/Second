import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600",
        destructive: "border-transparent bg-destructive/12 text-destructive border-destructive/30 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600",
        outline: "text-foreground",
        success: "border-success/30 bg-success/14 text-success dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600",
        warning: "border-warning/35 bg-warning/18 text-warning dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600",
        info: "border-info/30 bg-info/12 text-info dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
