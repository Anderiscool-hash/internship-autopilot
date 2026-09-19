import { promises as dns } from "node:dns";
export type MailProvider = "google" | "microsoft" | "other" | "none";
export interface MxResult { hasMx: boolean; provider: MailProvider; hosts: string[]; }
export interface MxRecord { priority: number; exchange: string; }
export type MxResolver = (hostname: string) => Promise<MxRecord[]>;
const suffixes: ReadonlyArray<{suffix:string;provider:MailProvider}> = [
  {suffix:"google.com",provider:"google"}, {suffix:"googlemail.com",provider:"google"},
  {suffix:"protection.outlook.com",provider:"microsoft"}, {suffix:"outlook.com",provider:"microsoft"},
];
function noMx(): MxResult { return {hasMx:false,provider:"none",hosts:[]}; }
export async function lookupMx(domain: string, resolveMx: MxResolver = dns.resolveMx): Promise<MxResult> {
  let records: MxRecord[];
  try { records = await resolveMx(domain); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return noMx();
    throw error;
  }
  const hosts = [...records].sort((a,b)=>a.priority-b.priority)
    .map(r=>r.exchange.trim().toLowerCase().replace(/\.$/,"")).filter(Boolean);
  if (!hosts.length) return noMx();
  const provider = suffixes.find(({suffix})=>hosts.some(h=>h===suffix || h.endsWith(`.${suffix}`)))?.provider ?? "other";
  return {hasMx:true,provider,hosts};
}
