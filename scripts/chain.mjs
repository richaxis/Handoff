// node scripts/chain.mjs read <fn> [arg...]   |   node scripts/chain.mjs receipt <hash>
import { createClient } from "genlayer-js";
import { makeConfig, makeChain, plain } from "../lib/chain.js";
const cfg = makeConfig(process.env);
const client = createClient({ chain: makeChain(cfg) });
const [cmd, a, ...rest] = process.argv.slice(2);
if (cmd === "read") console.log(plain(await client.readContract({ address: cfg.address, functionName: a, args: rest.map((x) => (/^\d+$/.test(x) ? Number(x) : x)) })));
else if (cmd === "receipt") console.log(JSON.stringify(await client.getTransaction({ hash: a }), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
else console.log("usage: chain.mjs read <fn> [args] | receipt <hash>");
