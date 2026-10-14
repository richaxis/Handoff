// npm run configure -- 0xCONTRACT_ADDRESS [https://your-site.vercel.app]
// Writes the address into public/deployment.json, .env, docs/EVIDENCE.md and PRODUCTION_STATUS.md in one go.
import fs from "node:fs";
const [addr, site] = process.argv.slice(2);
if (!/^0x[0-9a-fA-F]{40}$/.test(addr || "")) throw new Error("Usage: npm run configure -- 0xCONTRACT_ADDRESS [https://site-url]");
const edit = (file, fn) => { const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; fs.writeFileSync(file, fn(text)); console.log("updated", file); };
edit("public/deployment.json", (t) => { const j = t ? JSON.parse(t) : {}; j.address = addr; return JSON.stringify(j, null, 2) + "\n"; });
edit(".env", (t) => (/^VITE_CONTRACT_ADDRESS=.*$/m.test(t) ? t.replace(/^VITE_CONTRACT_ADDRESS=.*$/m, `VITE_CONTRACT_ADDRESS=${addr}`) : t + `\nVITE_CONTRACT_ADDRESS=${addr}\n`));
edit("docs/EVIDENCE.md", (t) => t.replace(/Contract address: `[^`]*`/, `Contract address: \`${addr}\``).replace(/Frontend URL: .*/, site ? `Frontend URL: ${site}` : "$&"));
edit("PRODUCTION_STATUS.md", (t) => t.replace(/address: _+/, `address: ${addr}`));
console.log("Now set the same VITE_CONTRACT_ADDRESS in Vercel and redeploy.");
