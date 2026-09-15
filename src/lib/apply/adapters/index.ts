/** Temporary stub — Task 4 replaces this file with the real registry. */
export function adapterFor(atsType: string): { id: string } {
  const known = ["GREENHOUSE", "LEVER", "ASHBY"];
  return { id: known.includes(atsType) ? atsType.toLowerCase() : "generic" };
}
