import { Onboarding } from "@/components/onboarding/Onboarding";

/**
 * THE FIRST-TIME FLOW (M54). Behind the session gate like every surface, and
 * deliberately OUTSIDE the platform shell: the rail, the bar and the assistant
 * are doors out of a flow that is walked once, in order, and the flow draws
 * its own chrome (the five-stage rail). The shell sends every member whose
 * `onboarding_completed_at` is null here; finishing — or «later» — stamps it
 * and the shell stops sending.
 */
export default function OnboardingPage() {
  return <Onboarding />;
}
