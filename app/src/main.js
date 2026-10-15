import { makeConfig, connectWallet, disconnectWallet, ensureChain, makeClient, read, write, loadJobs, isTransient, toWei, fromWei, short, same } from "../../lib/chain.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = makeConfig(import.meta.env);
let client = makeClient(cfg);
let me = null, jobs = [], credit = "0", busy = false, conf = null;
const F = { role: "all", st: "all", q: "" };
const OPEN = ["funded", "submitted", "disputed"];
const now = () => Math.floor(Date.now() / 1000);
const dur = (s) => (s >= 3600 ? Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m" : Math.max(1, Math.floor(s / 60)) + "m");
const LABEL = { funded: "Funded · open", submitted: "In review", disputed: "Disputed", paid: "Paid", auto_paid: "Paid (review ended)", refunded: "Refunded", cancelled: "Cancelled", accepted: "Accepted", rejected: "Rejected", inconclusive: "Split 50/50", expired: "Split 50/50" };
const GROUP = (s) => (s === "funded" ? "open" : s === "submitted" ? "review" : s === "disputed" ? "disputed" : "closed");

function toast(t) { const e = $("toast"); e.textContent = t; e.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("on"), 7000); }
const banner = (t) => { $("banner").textContent = t || ""; $("banner").classList.toggle("on", !!t); };
const txKey = () => `hf:tx:${cfg.address}:${(me || "").toLowerCase()}`;
const txlog = () => { try { return JSON.parse(localStorage.getItem(txKey()) || "[]"); } catch { return []; } };
const txpush = (e) => { try { localStorage.setItem(txKey(), JSON.stringify([e, ...txlog()].slice(0, 30))); } catch {} };
const roleOf = (j) => (same(j.client, me) ? "client" : same(j.freelancer, me) ? "freelancer" : null);

function actions(j) {
  const c = roleOf(j) === "client", f = roleOf(j) === "freelancer", d = busy ? "disabled" : "";
  const b = (act, label, ghost = true, off = false) => `<button class="btn ${ghost ? "ghost" : ""}" data-act="${act}" data-id="${j.id}" ${d || off ? "disabled" : ""}>${label}</button>`;
  if (j.status === "funded") {
    if (c) return "Waiting for the freelancer " + b("cancel", "Cancel &amp; recover payment");
    if (f) return `<div style="width:100%"><input class="jinp" id="u${j.id}" placeholder="https:// link to your delivered work"><button class="btn" data-act="submit" data-id="${j.id}" ${d}>Submit work</button></div>`;
    return "Waiting for the freelancer to submit work";
  }
  if (j.status === "submitted") {
    const left = conf ? j.submitted_at + conf.review_window_seconds - now() : null;
    if (c) return b("approve", "Approve &amp; pay", false) + (left > 0 ? b("dispute", "Dispute") + `<span>Dispute within ${dur(left)}; after that the freelancer can claim.</span>` : "<span>The review window has ended: only approval is possible, and the freelancer can claim payment.</span>");
    if (f) return b("claim", left > 0 ? `Claim payment in ${dur(left)}` : "Claim payment", false, left > 0) + b("concede", "Concede &amp; refund client");
    return "Under review by the client";
  }
  if (j.status === "disputed") {
    const left = conf ? j.disputed_at + conf.dispute_timeout_seconds - now() : null;
    return b("resolve", "Resolve with validators", false) + (left !== null && left <= 0 ? b("expire", "Timeout reached: split 50/50") : left !== null ? `<span>Unresolved? Split unlocks in ${dur(left)}</span>` : "") + (f ? b("concede", "Concede") : "");
  }
  return "Settled: " + (LABEL[j.status] || j.status);
}
function nextStep(j) {
  const r = roleOf(j);
  if (j.status === "funded") return r === "freelancer" ? "Submit your work" : "Waiting for freelancer";
  if (j.status === "submitted") return r === "client" ? "Approve or dispute" : "Awaiting client review";
  if (j.status === "disputed") return "Resolve with validators";
  return "Completed";
}

const evidence = (j) => j.evidence_hash ? `<details class="ev"><summary>Evidence captured at submission</summary><small>sha256 ${esc(j.evidence_hash)}</small><p><b>${j.evidence_truncated ? `Partial: first ${j.evidence_excerpt.length} of ${j.evidence_length} characters. A partial page can never cause a rejection.` : `Complete page (${j.evidence_length} characters).`}</b>${j.proof_phrase ? ` Proof phrase verified: “${esc(j.proof_phrase)}”.` : ""}</p><p>${esc(j.evidence_excerpt.slice(0, 600))}…</p></details>` : "";
const card = (j) => { const r = roleOf(j); return `<article class="card job"><div class="jt"><h3>${esc(j.title)}</h3><span class="badge ${j.status}">${LABEL[j.status] || j.status}</span></div>
<div class="jm"><span><b>${fromWei(j.amount)} GEN</b> fixed price</span><span>Client <b>${esc(short(j.client))}</b></span><span>Freelancer <b>${esc(short(j.freelancer))}</b></span><span>#${j.id}</span>${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noopener">View delivered work</a>` : ""}</div>
<p class="jc">${esc(j.criteria)}</p><div class="tags"><span class="tag">Payment in escrow</span><span class="tag">Judged by validators</span>${r ? `<span class="tag you">You are the ${r}</span>` : ""}</div>
<div class="act" id="v${j.id}">${actions(j)}</div>${evidence(j)}</article>`; };

function visible() {
  const q = F.q.toLowerCase();
  return jobs.filter((j) => (F.role === "all" || (me && roleOf(j) === F.role)) && (F.st === "all" || GROUP(j.status) === F.st)
    && (!q || `${j.title} ${j.criteria} #${j.id}`.toLowerCase().includes(q)));
}

function stats() {
  const held = jobs.filter((j) => OPEN.includes(j.status)).reduce((a, j) => a + BigInt(j.amount), 0n);
  $("s1").textContent = jobs.length; $("s2").textContent = fromWei(held, 2);
  $("s3").textContent = jobs.filter((j) => !OPEN.includes(j.status) && j.status !== "cancelled").length;
  $("cred").textContent = fromWei(credit) + " GEN"; $("wd").disabled = busy || BigInt(credit) === 0n;
}
function dash() {
  if (!me) { ["dstats", "dtable", "dtx"].forEach((i) => ($(i).innerHTML = "")); $("dsub").textContent = "Connect your wallet to see your jobs."; return; }
  $("dsub").textContent = "Everything you posted or were hired for on this contract.";
  const mine = jobs.filter((j) => roleOf(j));
  const sum = (role) => mine.filter((j) => roleOf(j) === role && OPEN.includes(j.status)).reduce((a, j) => a + BigInt(j.amount), 0n);
  const k = (v, l) => `<div class="card"><strong>${v}</strong><span>${l}</span></div>`;
  $("dstats").innerHTML = k(mine.length, "jobs you're part of") + k(fromWei(sum("client"), 2), "GEN you have in escrow") + k(fromWei(sum("freelancer"), 2), "GEN pending to you") + k(fromWei(credit, 2), "GEN ready to withdraw");
  $("dtable").innerHTML = mine.length ? mine.slice().reverse().map((j) => `<tr><td><b>${esc(j.title)}</b><div style="color:var(--mute);font-size:12.5px">#${j.id}</div></td><td>${roleOf(j)}</td><td>${fromWei(j.amount)} GEN</td><td><span class="badge ${j.status}">${LABEL[j.status] || j.status}</span></td><td>${nextStep(j)}</td><td><button class="btn ghost" data-open="${j.id}">Open</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty">No jobs yet. Post one or get hired.</td></tr>`;
  const ex = cfg.explorer.replace(/\/$/, "");
  $("dtx").innerHTML = txlog().length ? txlog().map((t) => `<div class="drow"><div><b>${esc(t.label)}</b><small>${new Date(t.at).toLocaleString()} · ${t.finalized ? "finalized and verified ✓" : String(t.label).includes("failed") ? "failed" : "accepted, awaiting finalization"}</small></div><a href="${ex}/tx/${esc(t.hash)}" target="_blank" rel="noopener">${esc(t.hash.slice(0, 10))}…</a></div>`).join("") : `<p class="empty">Transactions you send from this browser will appear here.</p>`;
}
function draw() {
  stats(); dash();
  const v = visible(); $("count").textContent = `(${v.length})`;
  $("list").innerHTML = v.length ? v.slice().reverse().map(card).join("") : `<div class="card">${jobs.length ? "No jobs match your filters." : "No jobs yet. Lock a payment to post the first one."}</div>`;
}

const cacheKey = () => `hf:jobs:${cfg.address}`;
let lastRefresh = 0, retryTimer = null;
function loadCache() { try { return JSON.parse(localStorage.getItem(cacheKey()) || "{}"); } catch { return {}; } }
function saveCache() { try { localStorage.setItem(cacheKey(), JSON.stringify(Object.fromEntries(jobs.filter((j) => !OPEN.includes(j.status)).map((j) => [j.id, j])))); } catch {} }

async function refresh(force = false) {
  if (!cfg.address) return;
  if (!force && jobs.length && Date.now() - lastRefresh < 15000) return draw(); // be gentle with the rate limit
  try {
    jobs = await loadJobs(client, cfg, loadCache());
    if (!conf) conf = JSON.parse(await read(client, cfg, "get_config"));
    if (me) credit = String(await read(client, cfg, "get_credit", [me]));
    lastRefresh = Date.now(); saveCache(); banner("");
  } catch (e) {
    if (isTransient(e)) { banner("The Studio network is temporarily unavailable or busy (" + String(e.message || e).slice(0, 90) + "). This is not a problem with your contract address. Showing saved data and retrying automatically."); clearTimeout(retryTimer); retryTimer = setTimeout(() => refresh(true), 30000); }
    else banner("This address does not answer like a Handoff contract (or the network is unreachable). Check VITE_CONTRACT_ADDRESS. Detail: " + String(e.message || e).slice(0, 120));
  }
  draw();
}
async function tx(label, fn) {
  if (!cfg.address) return toast("Set VITE_CONTRACT_ADDRESS first");
  if (!me) return toast("Connect a wallet first");
  try { await ensureChain(cfg); } catch (e) { return toast(e.message || "Switch your wallet to Studio"); }
  cur.label = label; busy = true; draw(); toast(label + "…");
  try { const { hash, finalized } = await fn(); markFinal(hash); toast(label + (finalized ? " done: finalized and verified ✓ " : " done ") + hash.slice(0, 10) + "…"); }
  catch (e) {
    if (e.hash && !txlog().some((t) => t.hash === e.hash)) txpush({ label: label + " (failed)", hash: e.hash, at: Date.now() });
    console.error(label, e); toast((e.shortMessage || e.message || "Transaction failed").slice(0, 220));
  }
  busy = false; await refresh(true);
}

$("pub").onclick = () => {
  const title = $("f1").value.trim(), crit = $("f2").value.trim(), who = $("f3").value.trim();
  let amt; try { amt = toWei($("f4").value); } catch (e) { return toast(e.message); }
  if (!title || crit.length < 20 || !/^0x[0-9a-fA-F]{40}$/.test(who)) return toast("Add a title, criteria (20+ characters) and a valid 0x… freelancer address");
  if (same(who, me)) return toast("The freelancer must be a different account");
  tx("Creating job", async () => { const r = await write(client, cfg, "create_job", [title, crit, who, $("f5").value.trim()], amt, opts("create")); ["f1", "f2", "f3", "f5"].forEach((x) => ($(x).value = "")); return r; });
};
// Every write is confirmed by an authoritative state readback, and finalization is tracked in the transaction list.
const EXPECT = { cancel: ["cancelled"], submit: ["submitted"], approve: ["paid"], dispute: ["disputed"], concede: ["refunded"], claim: ["auto_paid"], expire: ["expired"], resolve: ["accepted", "rejected", "inconclusive"] };
const cur = { label: "" };
function opts(act, id) {
  const verify = async () => {
    if (act === "create") return Number(await read(client, cfg, "get_job_count")) > jobs.length;
    if (act === "withdraw") return String(await read(client, cfg, "get_credit", [me])) === "0";
    return EXPECT[act].includes(JSON.parse(await read(client, cfg, "get_job", [id])).status);
  };
  return { verify, requireFinalized: true, onAccepted: (hash) => { txpush({ label: cur.label, hash, at: Date.now(), finalized: false }); toast(cur.label + ": accepted, waiting for finalization…"); refresh(true); } };
}
function markFinal(hash) {
  try { const l = txlog().map((t) => (t.hash === hash ? { ...t, finalized: true } : t)); localStorage.setItem(txKey(), JSON.stringify(l)); } catch {}
  dash();
}
const METHOD = { cancel: "cancel_job", approve: "approve", dispute: "dispute", concede: "concede", claim: "claim_after_review", expire: "claim_expired_dispute", resolve: "resolve", submit: "submit_work" };
const TEXT = { cancel: "Cancelling", approve: "Approving", dispute: "Disputing", concede: "Conceding", claim: "Claiming payment", expire: "Splitting escrow", resolve: "Resolving", submit: "Submitting work" };
$("list").onclick = (e) => {
  const act = e.target.dataset.act; if (!act) return;
  const id = Number(e.target.dataset.id); let args = [id];
  if (act === "submit") { const url = ($("u" + id).value || "").trim(); if (!/^https:\/\//.test(url)) return toast("Enter an https:// link to your work"); args = [id, url]; }
  if (act === "resolve" || act === "submit") $("v" + id).insertAdjacentHTML("beforeend", '<div class="dots"><i></i><i></i><i></i><i></i><i></i>Validators are working…</div>');
  tx(TEXT[act], () => write(client, cfg, METHOD[act], args, 0n, opts(act, id)));
};
$("wd").onclick = () => tx("Withdrawing", () => write(client, cfg, "withdraw", [], 0n, opts("withdraw")));

function view(name) {
  $("view-market").hidden = name !== "market"; $("view-dash").hidden = name !== "dash";
  document.querySelectorAll(".navb[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-view],[data-go],[data-open],[data-role],[data-st]"); if (!t) return;
  if (t.dataset.view) { e.preventDefault(); view(t.dataset.view); }
  if (t.dataset.go) { view("market"); setTimeout(() => $(t.dataset.go).scrollIntoView({ behavior: "smooth" }), 30); }
  if (t.dataset.open) { F.q = "#" + t.dataset.open; $("q").value = F.q; F.role = "all"; F.st = "all"; sync(); view("market"); draw(); }
  if (t.dataset.role) { F.role = t.dataset.role; sync(); draw(); }
  if (t.dataset.st) { F.st = t.dataset.st; sync(); draw(); }
});
function sync() { document.querySelectorAll("[data-role]").forEach((b) => b.classList.toggle("on", b.dataset.role === F.role)); document.querySelectorAll("[data-st]").forEach((b) => b.classList.toggle("on", b.dataset.st === F.st)); }
$("q").oninput = (e) => { F.q = e.target.value.trim(); view("market"); draw(); };

function setAccount(a) { me = a || null; credit = "0"; client = makeClient(cfg, me || undefined); $("wbtn").textContent = me ? short(me) : "Connect wallet"; $("wout").hidden = !me; draw(); refresh(true); }
$("wbtn").onclick = async () => { try { setAccount(await connectWallet(cfg, true)); toast("Connected"); } catch (e) { toast(e.message || "Wallet request was rejected"); } };
$("wout").onclick = async () => { await disconnectWallet(); setAccount(null); toast("Disconnected"); };
if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", (a) => { if (a[0] || me) setAccount(a[0] || null); });
  window.ethereum.on("chainChanged", () => toast("Network changed. We will switch back to Studio before sending."));
}
(async () => {
  if (!cfg.address) { try { cfg.address = (await (await fetch("/deployment.json")).json()).address || ""; } catch {} }
  $("addr").textContent = cfg.address || "not set";
  if (!cfg.address) banner("No contract address yet. Deploy handoff.py, then set VITE_CONTRACT_ADDRESS (or public/deployment.json).");
  jobs = Object.values(loadCache()); draw(); refresh(true);
})();
