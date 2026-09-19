"use client";

/**
 * Copy one draft to the clipboard.
 *
 * The smallest possible island: everything else on /contacts is a server
 * component, and this exists only because writing to the clipboard needs a
 * click handler in the browser.
 *
 * It is deliberately not the only way to get the text out. The page renders
 * the draft in a readonly textarea next to this button, because
 * navigator.clipboard requires a secure context and can be denied by policy,
 * and the copy path is the fallback that must never itself need a fallback
 * (design §7: "unconditional and always present").
 */

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // No secure context, or the user denied clipboard access. Say so
      // rather than showing "Copied" over a clipboard that did not change.
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 3000);
  }

  return (
    <button type="button" className="small-button" onClick={copy}>
      {state === "copied" ? "Copied" : state === "failed" ? "Select it below" : label}
    </button>
  );
}
