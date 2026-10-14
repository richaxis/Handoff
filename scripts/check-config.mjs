// Runs before every build. A production build without a contract address would show "Contract not set".
import fs from "node:fs";
const ok = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
let file = "";
try { file = JSON.parse(fs.readFileSync(new URL("../public/deployment.json", import.meta.url), "utf8")).address; } catch {}
const env = process.env.VITE_CONTRACT_ADDRESS;
if (ok(env) || ok(file)) { console.log("contract address configured:", ok(env) ? env : file); process.exit(0); }
const msg = "No valid contract address: set VITE_CONTRACT_ADDRESS (Vercel) or run `npm run configure -- 0xYourAddress`.";
if (process.env.VERCEL) { console.error("ERROR: " + msg); process.exit(1); }
console.warn("WARNING: " + msg);
