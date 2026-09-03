import { Suspense } from "react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PageContainer } from "@/components/scaffold";
import { TaskBoard } from "@/components/platform/TaskBoard";

/**
 * The task board (0144, the reference adoption). Suspense because the board
 * reads `?task=` for its deep link — `useSearchParams` forces a client
 * bailout, and without the boundary the production build refuses the page
 * while dev renders it perfectly (the build gate's whole reason to exist).
 */
export default function TasksPage() {
  return (
    <PlatformShell>
      {/* BIG — the board IS the width; a bound cuts off a column */}
      {/* THE ONE PAGE THAT ASKS FOR THE WIDER COLUMN (2026-09-03). It was
          `big` — which was not a size at all but the absence of a bound —
          and the directive moves it to the normal column: a board still
          needs room for its columns, but it stops being the one page in the
          product with no edge. */}
      <PageContainer width="normal">
        <Suspense fallback={null}>
          <TaskBoard />
        </Suspense>
      </PageContainer>
    </PlatformShell>
  );
}
