import type { ReactNode } from "react";

// The locale layout owns <html>; this root only satisfies Next's requirement.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
