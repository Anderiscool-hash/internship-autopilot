import { createHash } from "node:crypto";
export const GRAVATAR_REQUEST_DELAY_MS = 150;
export function gravatarHash(address: string): string {
  return createHash("md5").update(address.trim().toLowerCase()).digest("hex");
}
const delay = (ms:number) => new Promise<void>(resolve=>setTimeout(resolve,ms));
let gate: Promise<unknown> = Promise.resolve();
function throttled<T>(work:()=>Promise<T>): Promise<T> {
  const result = gate.then(work);
  gate = result.then(()=>delay(GRAVATAR_REQUEST_DELAY_MS),()=>delay(GRAVATAR_REQUEST_DELAY_MS));
  return result;
}
export async function hasGravatar(address: string): Promise<boolean> {
  const url = `https://www.gravatar.com/avatar/${gravatarHash(address)}?d=404`;
  return throttled(async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000),
        headers: {"User-Agent":"InternshipAutopilot/1.0","Accept":"image/*"} });
      return response.status === 200;
    } catch { return false; }
  });
}
