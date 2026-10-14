# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json

from genlayer import *

VERSION = "3.0.0"
VERDICTS = ("accepted", "rejected", "inconclusive")
MAX_TITLE, MIN_CRIT, MAX_CRIT, MAX_URL = 120, 20, 800, 300
MIN_PROOF, MAX_PROOF = 4, 200
EVIDENCE_LIMIT = 6000  # normalized characters of the delivered page that are stored as evidence
MIN_WINDOW, MAX_WINDOW = 60, 30 * 24 * 3600  # seconds
DEFAULT_REVIEW, DEFAULT_DISPUTE = 3 * 24 * 3600, 24 * 3600  # used when the deploy form is left at 0
TRANSFER_GRACE = 3600  # seconds before an unconfirmed outgoing transfer may be re-credited
# Fallback clock for runners that do not expose the transaction time: validators read a public clock and agree on
# the value rounded down to CLOCK_BUCKET seconds, so timeouts are then accurate to about 5 minutes.
CLOCK_URLS = ("https://worldtimeapi.org/api/timezone/Etc/UTC", "https://timeapi.io/api/Time/current/zone?timeZone=UTC")
CLOCK_BUCKET = 300

_K = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
]


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _ror(x: int, n: int) -> int:
    return ((x >> n) | (x << (32 - n))) & 0xFFFFFFFF


def _sha256_hex(text: str) -> str:
    """Pure-Python SHA-256 so the contract does not depend on any extra stdlib module."""
    data = text.encode("utf-8")
    h = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
    bits = len(data) * 8
    data += b"\x80"
    data += b"\x00" * ((56 - len(data) % 64) % 64)
    data += bits.to_bytes(8, "big")
    for i in range(0, len(data), 64):
        w = [int.from_bytes(data[i + j * 4: i + j * 4 + 4], "big") for j in range(16)]
        for j in range(16, 64):
            s0 = _ror(w[j - 15], 7) ^ _ror(w[j - 15], 18) ^ (w[j - 15] >> 3)
            s1 = _ror(w[j - 2], 17) ^ _ror(w[j - 2], 19) ^ (w[j - 2] >> 10)
            w.append((w[j - 16] + s0 + w[j - 7] + s1) & 0xFFFFFFFF)
        a, b, c, d, e, f, g, k = h
        for j in range(64):
            t1 = (k + (_ror(e, 6) ^ _ror(e, 11) ^ _ror(e, 25)) + ((e & f) ^ ((~e) & g)) + _K[j] + w[j]) & 0xFFFFFFFF
            t2 = ((_ror(a, 2) ^ _ror(a, 13) ^ _ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) & 0xFFFFFFFF
            k, g, f, e, d, c, b, a = g, f, e, (d + t1) & 0xFFFFFFFF, c, b, a, (t1 + t2) & 0xFFFFFFFF
        h = [(x + y) & 0xFFFFFFFF for x, y in zip(h, [a, b, c, d, e, f, g, k])]
    return "".join(f"{x:08x}" for x in h)


def _unix(iso: str) -> int:
    """'2026-09-27T09:14:14.081651Z' -> unix seconds, integer math only (datetime is forbidden in contracts)."""
    y, mo, d = int(iso[0:4]), int(iso[5:7]), int(iso[8:10])
    hh, mi, ss = int(iso[11:13]), int(iso[14:16]), int(iso[17:19])
    y -= 1 if mo <= 2 else 0
    era = y // 400
    yoe = y - era * 400
    doy = (153 * ((mo + 9) % 12) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return (era * 146097 + doe - 719468) * 86400 + hh * 3600 + mi * 60 + ss


def _now_soft() -> int:
    """Transaction time from the runtime, or 0 when it is not provided. Never triggers a web call."""
    try:
        return _unix(gl.message_raw["datetime"])
    except Exception:
        return 0


def _parse_clock(text: str) -> int:
    """Reads unix seconds from worldtimeapi ("unixtime") or timeapi.io ("dateTime") JSON. 0 if neither is found."""
    k = text.find('"unixtime"')
    if k >= 0:
        i = text.find(":", k) + 1
        while i < len(text) and text[i] == " ":
            i += 1
        digits = ""
        while i < len(text) and text[i].isdigit():
            digits += text[i]
            i += 1
        if len(digits) >= 9:
            return int(digits)
    k = text.find('"dateTime"')
    if k >= 0:
        i = text.find('"', text.find(":", k) + 1) + 1
        iso = text[i: i + 19]
        if len(iso) == 19 and iso[4] == "-" and iso[10] == "T":
            return _unix(iso)
    return 0


def _web_time() -> int:
    """Consensus clock for runners without transaction time: validators agree on a bucketed public-clock reading."""

    def read() -> str:
        for url in CLOCK_URLS:
            try:
                t = _parse_clock(gl.nondet.web.render(url, mode="text"))
            except Exception:
                t = 0
            if t > 1_600_000_000:
                return str((t // CLOCK_BUCKET) * CLOCK_BUCKET)
        return "0"

    return int(gl.eq_principle.strict_eq(read))


def _now_strict() -> int:
    """Authoritative time. Time-dependent operations FAIL instead of storing an invalid timestamp."""
    t = _now_soft()
    if t <= 0:
        t = _web_time()
    if t <= 0:
        raise gl.vm.UserError("authoritative time is unavailable; nothing was changed, try again later")
    return t


def _parse_judgement(raw: str):
    """Strict parsing: JSON {"verdict": ..., "support_quote": ...} or one bare word. Unclear means inconclusive."""
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    verdict, quote = "", ""
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            verdict = str(obj.get("verdict", "")).strip().lower()
            quote = str(obj.get("support_quote", "")).strip()
    except Exception:
        verdict = cleaned.lower().strip(" \n\t\"'.")
    return (verdict if verdict in VERDICTS else "inconclusive", quote)


def _final_verdict(verdict: str, quote: str, excerpt: str, truncated: bool) -> str:
    """Deterministic guard rails applied to the model's answer."""
    if verdict == "accepted":
        q = _norm(quote)
        if len(q) < 8 or q not in excerpt:  # acceptance must be backed by text that really is in the evidence
            return "inconclusive"
    if verdict == "rejected" and truncated:  # absence cannot be proven from partial evidence
        return "inconclusive"
    return verdict


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class Handoff(gl.Contract):
    jobs: TreeMap[u256, str]  # job id -> JSON record
    credits: TreeMap[Address, u256]  # withdrawable balances
    pending: TreeMap[u256, str]  # outgoing transfers not yet confirmed as delivered
    next_id: u256
    review_window: u256  # seconds the client has to approve or dispute; afterwards the freelancer can claim
    dispute_timeout: u256  # seconds a dispute may stay unresolved before anyone can split the escrow
    funds_in: u256  # cumulative GEN received through create_job
    confirmed_out: u256  # cumulative GEN confirmed as delivered by reconcile()
    next_pending: u256
    pending_head: u256
    anomaly: u256  # GEN that left the contract without a matching pending transfer (recovery is disabled if > 0)

    def __init__(self, review_window_seconds: int, dispute_timeout_seconds: int):
        if review_window_seconds == 0:
            review_window_seconds = DEFAULT_REVIEW
        if dispute_timeout_seconds == 0:
            dispute_timeout_seconds = DEFAULT_DISPUTE
        for v in (review_window_seconds, dispute_timeout_seconds):
            if v < MIN_WINDOW or v > MAX_WINDOW:
                raise gl.vm.UserError("windows must be between 60 seconds and 30 days")
        self.next_id = u256(0)
        self.review_window = u256(review_window_seconds)
        self.dispute_timeout = u256(dispute_timeout_seconds)
        self.funds_in = u256(0)
        self.confirmed_out = u256(0)
        self.next_pending = u256(0)
        self.pending_head = u256(0)
        self.anomaly = u256(0)

    # ---------- write ----------

    @gl.public.write.payable
    def create_job(self, title: str, criteria: str, freelancer: str, proof_phrase: str) -> None:
        """Client locks the payment and writes the criteria. proof_phrase (optional) must appear on the delivered page."""
        amount = gl.message.value
        title, criteria, proof_phrase = title.strip(), criteria.strip(), proof_phrase.strip()
        if amount == 0:
            raise gl.vm.UserError("send the payment amount")
        if not title or len(title) > MAX_TITLE:
            raise gl.vm.UserError("title must be 1-120 characters")
        if len(criteria) < MIN_CRIT or len(criteria) > MAX_CRIT:
            raise gl.vm.UserError("acceptance criteria must be 20-800 characters")
        if proof_phrase and (len(proof_phrase) < MIN_PROOF or len(proof_phrase) > MAX_PROOF):
            raise gl.vm.UserError("proof phrase must be empty or 4-200 characters")
        try:
            freelancer_hex = Address(freelancer.strip()).as_hex
        except Exception:
            raise gl.vm.UserError("freelancer must be a valid wallet address")
        client_hex = gl.message.sender_address.as_hex
        if freelancer_hex == client_hex:
            raise gl.vm.UserError("the freelancer must be a different account")
        record = {
            "client": client_hex,
            "freelancer": freelancer_hex,
            "title": title,
            "criteria": criteria,
            "criteria_hash": _sha256_hex(_norm(criteria)),
            "proof_phrase": proof_phrase,
            "amount": int(amount),
            "status": "funded",  # funded|submitted|disputed|paid|auto_paid|refunded|cancelled|accepted|rejected|inconclusive|expired
            "url": "",
            "submitted_at": 0,
            "disputed_at": 0,
            "evidence_excerpt": "",
            "evidence_hash": "",
            "evidence_truncated": False,
            "evidence_length": 0,
            "evidence_note": "",
        }
        self.jobs[self.next_id] = json.dumps(record)
        self.next_id = u256(int(self.next_id) + 1)
        self.funds_in = u256(int(self.funds_in) + int(amount))

    @gl.public.write
    def cancel_job(self, job_id: int) -> None:
        """Escrow recovery 1: the client takes the payment back before any work is submitted."""
        rec = self._load(job_id)
        self._only(rec, "client")
        if rec["status"] != "funded":
            raise gl.vm.UserError("work was already submitted")
        self._credit(Address(rec["client"]), rec["amount"])
        rec["status"] = "cancelled"
        self._save(job_id, rec)

    @gl.public.write
    def submit_work(self, job_id: int, url: str) -> None:
        """Freelancer submits an https link. Validators capture the page NOW and verify the proof phrase, if any."""
        rec = self._load(job_id)
        self._only(rec, "freelancer")
        if rec["status"] != "funded":
            raise gl.vm.UserError("job is not waiting for work")
        url = url.strip()
        if not url.startswith("https://") or len(url) > MAX_URL or " " in url:
            raise gl.vm.UserError("url must be an https:// link without spaces")
        now = _now_strict()  # fail before any state change if the time is unavailable
        proof = _norm(rec["proof_phrase"])

        def capture() -> str:
            def out(ok: bool, excerpt: str, truncated: bool, length: int, note: str) -> str:
                return json.dumps({"ok": ok, "excerpt": excerpt, "truncated": truncated, "length": length, "note": note}, sort_keys=True)

            try:
                page = gl.nondet.web.render(url, mode="text")
            except Exception:
                return out(False, "", False, 0, "submitted page could not be read")
            text = _norm(page)
            if len(text) < 50:
                return out(False, "", False, len(text), "submitted page has too little readable text")
            if proof and proof not in text:  # proof of function: the live page must show the marker the client chose
                return out(False, "", False, len(text), "the required proof phrase was not found on the submitted page")
            return out(True, text[:EVIDENCE_LIMIT], len(text) > EVIDENCE_LIMIT, len(text), "captured at submission")

        snap = json.loads(gl.eq_principle.strict_eq(capture))
        if not snap["ok"]:
            raise gl.vm.UserError(snap["note"])  # reverts, nothing changes

        rec["url"] = url
        rec["submitted_at"] = now
        rec["evidence_excerpt"] = snap["excerpt"]  # authoritative evidence, immune to later edits of the page
        rec["evidence_hash"] = _sha256_hex(snap["excerpt"])
        rec["evidence_truncated"] = snap["truncated"]
        rec["evidence_length"] = snap["length"]
        rec["evidence_note"] = snap["note"]
        rec["status"] = "submitted"
        self._save(job_id, rec)

    @gl.public.write
    def approve(self, job_id: int) -> None:
        """Client accepts the work: the freelancer is paid."""
        rec = self._load(job_id)
        self._only(rec, "client")
        if rec["status"] != "submitted":
            raise gl.vm.UserError("no submitted work to approve")
        self._credit(Address(rec["freelancer"]), rec["amount"])
        rec["status"] = "paid"
        self._save(job_id, rec)

    @gl.public.write
    def dispute(self, job_id: int) -> None:
        """Client rejects the work, but only INSIDE the review window: a matured claim cannot be invalidated."""
        rec = self._load(job_id)
        self._only(rec, "client")
        if rec["status"] != "submitted":
            raise gl.vm.UserError("no submitted work to dispute")
        now = _now_strict()
        if now >= rec["submitted_at"] + self.review_window:
            raise gl.vm.UserError("the review window has ended: the freelancer can claim payment")
        rec["status"] = "disputed"
        rec["disputed_at"] = now
        self._save(job_id, rec)

    @gl.public.write
    def concede(self, job_id: int) -> None:
        """Freelancer gives up: the client is refunded."""
        rec = self._load(job_id)
        self._only(rec, "freelancer")
        if rec["status"] not in ("submitted", "disputed"):
            raise gl.vm.UserError("nothing to concede")
        self._credit(Address(rec["client"]), rec["amount"])
        rec["status"] = "refunded"
        self._save(job_id, rec)

    @gl.public.write
    def claim_after_review(self, job_id: int) -> None:
        """Escrow recovery 2 (timeout): a silent client cannot hold the freelancer's payment forever."""
        rec = self._load(job_id)
        self._only(rec, "freelancer")
        if rec["status"] != "submitted":
            raise gl.vm.UserError("work is not waiting for review")
        if _now_strict() < rec["submitted_at"] + self.review_window:
            raise gl.vm.UserError("the review window has not ended")
        self._credit(Address(rec["freelancer"]), rec["amount"])
        rec["status"] = "auto_paid"
        self._save(job_id, rec)

    @gl.public.write
    def claim_expired_dispute(self, job_id: int) -> None:
        """Escrow recovery 3 (timeout): an unresolved dispute splits the escrow 50/50."""
        rec = self._load(job_id)
        if rec["status"] != "disputed":
            raise gl.vm.UserError("job is not disputed")
        if _now_strict() < rec["disputed_at"] + self.dispute_timeout:
            raise gl.vm.UserError("the dispute timeout has not been reached")
        self._split(rec)
        rec["status"] = "expired"
        self._save(job_id, rec)

    @gl.public.write
    def resolve(self, job_id: int) -> str:
        """Validators judge the stored evidence against the criteria; deterministic guard rails limit the model."""
        rec = self._load(job_id)
        if rec["status"] != "disputed":
            raise gl.vm.UserError("job is not disputed")

        # copy to locals: storage can't be read inside the non-deterministic block
        title, criteria, excerpt = rec["title"], rec["criteria"], rec["evidence_excerpt"]
        truncated, length = rec["evidence_truncated"], rec["evidence_length"]

        def judge() -> str:
            partial = (
                f"WARNING: this is only the first {len(excerpt)} of {length} characters of the page. "
                "Never answer rejected because something is missing from this excerpt."
                if truncated else "This is the complete page text."
            )
            task = f"""
A freelancer delivered work for the job "{title}".
Acceptance criteria written by the client:
{criteria}

Evidence captured at submission (normalized, lowercase). {partial}
{excerpt}
End of evidence.

Does the delivered work satisfy the acceptance criteria? "accepted" only if the evidence clearly shows it,
"rejected" if it clearly does not, "inconclusive" if the evidence is not enough to tell.
If you answer accepted, put a short support_quote copied EXACTLY from the evidence that proves it.
Respond only with JSON: {{"verdict": "accepted" | "rejected" | "inconclusive", "support_quote": "..."}}
"""
            try:
                verdict, quote = _parse_judgement(gl.nondet.exec_prompt(task))
            except Exception:
                verdict, quote = "inconclusive", ""
            return json.dumps({"verdict": _final_verdict(verdict, quote, excerpt, truncated)}, sort_keys=True)

        verdict = json.loads(gl.eq_principle.strict_eq(judge))["verdict"]
        if verdict not in VERDICTS:
            verdict = "inconclusive"
        if verdict == "accepted":
            self._credit(Address(rec["freelancer"]), rec["amount"])
        elif verdict == "rejected":
            self._credit(Address(rec["client"]), rec["amount"])
        else:
            self._split(rec)
        rec["status"] = verdict
        rec["evidence_note"] = "judged on the stored evidence"
        self._save(job_id, rec)
        return verdict

    @gl.public.write
    def withdraw(self) -> None:
        """Moves the caller's credit into a pending transfer and emits it. reconcile() later confirms delivery."""
        me = gl.message.sender_address
        amount = int(self.credits.get(me, u256(0)))
        if amount == 0:
            raise gl.vm.UserError("nothing to withdraw")
        self.credits[me] = u256(0)
        entry = {"to": me.as_hex, "amount": int(amount), "at": _now_soft(), "state": "pending"}  # at 0 = unknown time
        self.pending[self.next_pending] = json.dumps(entry)
        self.next_pending = u256(int(self.next_pending) + 1)
        _Recipient(me).emit_transfer(value=u256(int(amount)))

    @gl.public.write
    def reconcile(self) -> int:
        """Confirms delivered transfers (oldest first) by comparing the real contract balance with the ledger."""
        left = self._left()
        confirmed = 0
        while self.pending_head < self.next_pending:
            entry = json.loads(self.pending[self.pending_head])
            if entry["state"] == "pending":
                if entry["amount"] > left:
                    break
                left -= entry["amount"]
                self.confirmed_out = u256(int(self.confirmed_out) + entry["amount"])
                entry["state"] = "delivered"
                self.pending[self.pending_head] = json.dumps(entry)
                confirmed += 1
            self.pending_head = u256(int(self.pending_head) + 1)
        if self.pending_head >= self.next_pending and left > 0:
            self.anomaly = u256(left)  # money left the contract with no pending transfer to explain it
        return confirmed

    @gl.public.write
    def recover_failed_transfer(self) -> None:
        """Re-credits the OLDEST pending transfer only if nothing has left the contract and the grace time passed."""
        if self.pending_head >= self.next_pending:
            raise gl.vm.UserError("no pending transfer")
        entry = json.loads(self.pending[self.pending_head])
        if entry["state"] != "pending":
            raise gl.vm.UserError("call reconcile first")
        if self.anomaly > 0:
            raise gl.vm.UserError("an unexplained outflow was detected: recovery is disabled")
        if self._left() > 0:
            raise gl.vm.UserError("funds have left the contract: call reconcile instead")
        if entry["at"] <= 0:
            raise gl.vm.UserError("the transfer time is unknown: recovery is unavailable")
        if _now_strict() < entry["at"] + TRANSFER_GRACE:
            raise gl.vm.UserError("the grace period has not ended")
        self._credit(Address(entry["to"]), entry["amount"])  # nothing was delivered, so this cannot duplicate a payout
        entry["state"] = "recredited"
        self.pending[self.pending_head] = json.dumps(entry)
        self.pending_head = u256(int(self.pending_head) + 1)

    # ---------- view ----------

    @gl.public.view
    def get_job(self, job_id: int) -> str:
        if job_id < 0 or job_id >= self.next_id:
            raise gl.vm.UserError("unknown job")
        return self.jobs[u256(job_id)]  # JSON string; the frontend parses it

    @gl.public.view
    def get_job_count(self) -> int:
        return int(self.next_id)

    @gl.public.view
    def get_credit(self, account: str) -> str:
        return str(int(self.credits.get(Address(account), u256(0))))

    @gl.public.view
    def get_ledger(self) -> str:
        return json.dumps({
            "funds_in": int(self.funds_in), "confirmed_out": int(self.confirmed_out), "balance": int(self.balance),
            "pending_transfers": int(self.next_pending - self.pending_head), "unexplained_outflow": int(self.anomaly),
        })

    @gl.public.view
    def get_config(self) -> str:
        return json.dumps({"version": VERSION, "review_window_seconds": int(self.review_window),
                           "dispute_timeout_seconds": int(self.dispute_timeout), "evidence_limit": EVIDENCE_LIMIT})

    @gl.public.view
    def get_version(self) -> str:
        return VERSION

    # ---------- internal ----------

    def _left(self) -> int:
        """GEN that has left the contract but is not yet confirmed (expected balance minus real balance)."""
        expected = int(self.funds_in) - int(self.confirmed_out)
        bal = int(self.balance)
        return expected - bal if expected > bal else 0

    def _load(self, job_id: int) -> dict:
        if job_id < 0 or job_id >= self.next_id:
            raise gl.vm.UserError("unknown job")
        return json.loads(self.jobs[u256(job_id)])

    def _save(self, job_id: int, rec: dict) -> None:
        self.jobs[u256(job_id)] = json.dumps(rec)

    def _only(self, rec: dict, role: str) -> None:
        if gl.message.sender_address.as_hex != rec[role]:
            raise gl.vm.UserError(f"only the {role} can do this")

    def _credit(self, who: Address, amount: int) -> None:
        self.credits[who] = u256(int(self.credits.get(who, u256(0))) + int(amount))

    def _split(self, rec: dict) -> None:
        half = rec["amount"] // 2
        self._credit(Address(rec["client"]), half)
        self._credit(Address(rec["freelancer"]), rec["amount"] - half)
