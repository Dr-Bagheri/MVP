"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

/*
 * ONE ANIMATION FOR EVERY OVERLAY: it fades in, and that is all (user
 * directive, 2026-09-03: "the pop window appears with this animation that it
 * comes from side, change the animation to just slowly appears").
 *
 * shadcn ships each surface with a directional slide — `slide-in-from-top-2`
 * and its three siblings, chosen by the side the primitive resolved to. On a
 * menu anchored to a composer at the foot of a column that means it flies UP
 * into place, and on a dialog it means the box arrives from somewhere. Motion
 * that carries no information is motion that has to be read.
 *
 * What stays is the fade and a very slight zoom — 98%, not shadcn's 95% —
 * because a panel that appears with no transition at all reads as a repaint
 * rather than as something opening. `duration-150` is the whole of "slowly":
 * long enough to see, short enough that nobody waits for it.
 *
 * The slide classes are removed rather than overridden. An override would sit
 * in the same class list as the thing it cancels, and the next `shadcn add`
 * would bring the original back beside it with no conflict anyone could see.
 */

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
