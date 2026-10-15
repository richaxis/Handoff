import { createClient } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import { quoteFees, isBudgetTooLow, isMessageFeeError, feesUnsupported } from "./fees.js";
import { confirmTx } from "./confirm.js";
import { TransactionStatus } from "genlayer-js/types";
import { plain, executionOutcome, statusName, isTransient } from "./units.js";
export * from "./units.js";

export function makeConfig(env = {}) {
  return {
    address: env.VITE_CONTRACT_ADDRESS || "",
    rpc: env.VITE_RPC_URL || "https://studio.genlayer.com/api",
    chainId: Number(env.VITE_CHAIN_ID || 61999),
    explorer: env.VITE_EXPLORER_URL || "https://explorer-studio.genlayer.com",
  };
}

// Use the chain definition shipped with genlayer-js: chain id and consensus contract addresses must stay
// together, so we only override the RPC and explorer, never the id or addresses.
export function makeChain(cfg) {
  // genlayer-js ships the Studio network (chain 61999, https://studio.genlayer.com/api) as `studionet`.
  const base = chains.studionet ?? chains.studioNext ?? chains.studioDevnet;
  return {
    ...base,
    name: "GenLayer Studio",
    rpcUrls: { default: { http: [cfg.rpc] } },
    blockExplorers: { default: { name: "Explorer", url: cfg.explorer } },
  };
}

const chainHex = (cfg) => "0x" + cfg.chainId.toString(16);

// Makes sure the wallet is on Studio; asks the wallet to ADD the network if it doesn't know it.
export async function ensureChain(cfg) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  if ((await eth.request({ method: "eth_chainId" })).toLowerCase() === chainHex(cfg)) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex(cfg) }] });
  } catch (e) {
    if (e.code === 4001) throw new Error("You rejected the network switch.");
    // 4902 = unknown chain; some wallets use -32603 or a message instead
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: chainHex(cfg), chainName: "GenLayer Studio", rpcUrls: [cfg.rpc],
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, blockExplorerUrls: [cfg.explorer] }],
    });
  }
}

// fresh = true forces the wallet's account picker, so you can choose a different account.
export async function connectWallet(cfg, fresh = false) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  if (fresh) {
    try { await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }); }
    catch (e) { if (e.code === 4001) throw new Error("Connection rejected."); }
  }
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  await ensureChain(cfg);
  return account;
}

// Sites cannot force-disconnect a wallet, but we can revoke this site's permission where supported.
export async function disconnectWallet() {
  try { await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch {}
}

// Account is optional: reads work without a wallet, writes are signed by the wallet.
export const makeClient = (cfg, account) =>
  createClient({ chain: makeChain(cfg), ...(account ? { account } : {}) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isRateLimit = (e) => /rate limit|429|too many requests/i.test(String(e?.message ?? e) + String(e?.details ?? "") + String(e?.shortMessage ?? ""));

// The public RPC allows ~30 requests per minute and can return transient backend errors: wait and retry instead of failing.
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (!isTransient(e) || i >= 4) throw e; await sleep(4000 * (i + 1)); }
  }
}

export const read = (client, cfg, functionName, args = []) =>
  retry(() => client.readContract({ address: cfg.address, functionName, args })).then(plain);

export { executionOutcome, statusName };

// Sends a write and PROVES it worked (see confirmTx): accepted, execution result, state readback, and FINALIZED.
export async function write(client, cfg, functionName, args = [], value = 0n, opts = {}) {
  let lastError, zeroMsg = false;
  for (const scale of [1n, 4n, 16n]) {
    try {
      const fees = await quoteFees(client, functionName, scale, 1n, zeroMsg).catch((e) => { if (feesUnsupported(e)) return undefined; throw e; });
      const hash = await client.writeContract({ address: cfg.address, functionName, args, value, ...(fees ? { fees } : {}) });
      const wait = (status) => client.waitForTransactionReceipt({
        hash, status: TransactionStatus[status], retries: status === "FINALIZED" ? 90 : 60, interval: 10000, // slow polling keeps us under the RPC rate limit
      });
      return await confirmTx({ name: functionName, hash, wait, opts });
    } catch (e) {
      lastError = e;
      if (isMessageFeeError(e)) { zeroMsg = true; continue; } // retry without message fees (state was rolled back)
      if (!isBudgetTooLow(e)) throw e;
    }
  }
  throw lastError;
}

const OPEN_STATES = ["funded", "submitted", "disputed"];

// Settled jobs never change, so they are served from `cache` and only open jobs are fetched again.
export async function loadJobs(client, cfg, cache = {}) {
  const count = Number(await read(client, cfg, "get_job_count"));
  const out = [];
  for (let id = 0; id < count; id++) {
    const hit = cache[id];
    if (hit && !OPEN_STATES.includes(hit.status)) { out.push(hit); continue; }
    out.push({ id, ...JSON.parse(await read(client, cfg, "get_job", [id])) });
  }
  return out;
}
