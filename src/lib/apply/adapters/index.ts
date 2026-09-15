/**
 * The adapter registry.
 *
 * Keyed by the AtsType enum spelling so a job row maps straight to an adapter.
 * Anything not listed gets the generic adapter, which cannot submit — so adding
 * a new ATS to the schema can never accidentally enable submission on it.
 */

import type { AtsAdapter } from "./types";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { ashbyAdapter } from "./ashby";
import { genericAdapter } from "./generic";

const ADAPTERS: Record<string, AtsAdapter> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
};

export function adapterFor(atsType: string): AtsAdapter {
  return ADAPTERS[atsType] ?? genericAdapter;
}

export type { AtsAdapter } from "./types";
