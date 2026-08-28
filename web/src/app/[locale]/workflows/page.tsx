import { Suspense } from "react";
import { Workflows } from "@/components/platform/Workflows";

/**
 * **The Suspense boundary is required, not decorative.** `Workflows` reads
 * `?new=1` through `useSearchParams()` so the menu's "Create workflow" can
 * arrive here with the builder already opening. Next prerenders this route,
 * and a component reading search params forces a client bailout — without a
 * boundary ABOVE it the production build fails outright while the dev server
 * renders the page perfectly. (The same trap the assistant hit; the build
 * gate is what catches it.)
 *
 * `null` as the fallback, not a skeleton: the page's own loading state is
 * already nothing-until-loaded, and a placeholder would flash a second,
 * wrong version of a screen the user signed off.
 */
export default function WorkflowsPage() {
  return (
    <Suspense fallback={null}>
      <Workflows />
    </Suspense>
  );
}
