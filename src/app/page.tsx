// The app's front door.
//
// There is exactly one screen worth landing on right now — the job dashboard —
// so the root path forwards to it rather than showing a menu with one item.
// When Phase 3 adds match scores and Phase 7 adds the application tracker,
// this becomes a real overview page.

import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/jobs");
}
