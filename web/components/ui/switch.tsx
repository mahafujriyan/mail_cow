"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full bg-[#e5e7eb] transition data-[state=checked]:bg-brand dark:bg-[#3a4440]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
