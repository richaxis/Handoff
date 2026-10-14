"""Contract-level behavioural tests: the real handoff.py runs inside tests/sim.py."""
import json, sys
sys.path.insert(0, __import__("pathlib").Path(__file__).parent.as_posix())
from sim import Sim, UserError

A, B, C = "0x" + "a" * 40, "0x" + "b" * 40, "0x" + "c" * 40  # client, freelancer, outsider
URL = "https://example.org/work"
CRIT = "The delivered page must describe a working token faucet."
PAGE = "Token faucet project. This faucet works: it sends test tokens to any address. " * 3
ONE = 10 ** 18
passed = 0


def fails(fn, text=""):
    try:
        fn()
    except UserError as e:
        assert text.lower() in str(e).lower(), f"wrong error: {e!r} (wanted '{text}')"
        return
    raise AssertionError(f"expected UserError {text!r}")


def solvent(s):  # the contract always holds at least what it owes
    open_escrow = sum(s.job(i)["amount"] for i in range(int(s.obj.next_id)) if s.job(i)["status"] in ("funded", "submitted", "disputed"))
    assert s.balance >= open_escrow + sum(int(v) for v in s.obj.credits.values()), "contract is insolvent"


def new(review=0, dispute=0, proof=""):
    s = Sim(review, dispute)
    s.pages[URL] = PAGE
    s.call(A, "create_job", "Faucet", CRIT, B, proof, value=ONE)
    return s


def submitted(**kw):
    s = new(**kw)
    s.call(B, "submit_work", 0, URL)
    return s


def test(fn):
    global passed
    fn(); passed += 1; print("ok  ", fn.__name__)


@test
def constructor_defaults_and_bounds():
    s = Sim(0, 0)
    assert json.loads(s.obj.get_config())["review_window_seconds"] == 3 * 86400
    fails(lambda: Sim(30, 0), "between 60")
    fails(lambda: Sim(0, 31 * 86400), "between 60")


@test
def create_job_validation():
    s = Sim(0, 0)
    f = lambda *a, value=ONE: s.call(A, "create_job", *a, value=value)
    fails(lambda: f("t", CRIT, B, "", value=0), "payment")
    fails(lambda: f("", CRIT, B, ""), "title")
    fails(lambda: f("t", "short", B, ""), "criteria")
    fails(lambda: f("t", CRIT, "0x123", ""), "valid wallet")
    fails(lambda: f("t", CRIT, A, ""), "different account")
    fails(lambda: f("t", CRIT, B, "abc"), "proof phrase")
    assert s.balance == 0 and s.obj.next_id == 0  # every rejection returned the value and changed nothing


@test
def cancel_before_submission_and_authorization():
    s = new()
    fails(lambda: s.call(B, "cancel_job", 0), "only the client")
    fails(lambda: s.call(C, "cancel_job", 0), "only the client")
    s.call(A, "cancel_job", 0)
    assert s.job(0)["status"] == "cancelled" and s.credit(A) == ONE
    fails(lambda: s.call(A, "cancel_job", 0), "already submitted")
    fails(lambda: s.call(B, "submit_work", 0, URL), "not waiting")
    s2 = submitted()
    fails(lambda: s2.call(A, "cancel_job", 0), "already submitted")


@test
def submit_work_authorization_and_evidence():
    s = new()
    fails(lambda: s.call(A, "submit_work", 0, URL), "only the freelancer")
    fails(lambda: s.call(C, "submit_work", 0, URL), "only the freelancer")
    fails(lambda: s.call(B, "submit_work", 0, "http://example.org"), "https")
    s.pages[URL] = None
    fails(lambda: s.call(B, "submit_work", 0, URL), "could not be read")
    s.pages[URL] = "tiny"
    fails(lambda: s.call(B, "submit_work", 0, URL), "too little")
    s.pages[URL] = PAGE
    s.call(B, "submit_work", 0, URL)
    j = s.job(0)
    assert j["status"] == "submitted" and j["submitted_at"] == s.clock and len(j["evidence_hash"]) == 64
    assert j["evidence_truncated"] is False and j["evidence_length"] == len(" ".join(PAGE.lower().split()))
    s.pages[URL] = "the page was edited afterwards " * 5  # later edits cannot change the stored evidence
    assert s.job(0)["evidence_excerpt"].startswith("token faucet project")


@test
def long_pages_are_flagged_as_truncated():
    s = new()
    s.pages[URL] = "word " * 5000
    s.call(B, "submit_work", 0, URL)
    j = s.job(0)
    assert j["evidence_truncated"] is True and len(j["evidence_excerpt"]) == 6000 and j["evidence_length"] > 6000


@test
def proof_of_function_phrase_is_enforced():
    s = new(proof="Faucet status: ONLINE")
    fails(lambda: s.call(B, "submit_work", 0, URL), "proof phrase was not found")
    assert s.job(0)["status"] == "funded"
    s.pages[URL] = PAGE + " Faucet status: online "
    s.call(B, "submit_work", 0, URL)
    assert s.job(0)["status"] == "submitted"
    s2 = new(proof="Deployment OK")  # the phrase is searched in the FULL page, not just the stored excerpt
    s2.pages[URL] = "word " * 5000 + " deployment ok"
    s2.call(B, "submit_work", 0, URL)
    assert s2.job(0)["evidence_truncated"] is True


@test
def time_unavailable_fails_safely():
    s = new()
    s.time_ok = False
    fails(lambda: s.call(B, "submit_work", 0, URL), "time is unavailable")
    assert s.job(0)["status"] == "funded" and s.job(0)["submitted_at"] == 0  # no invalid timestamp stored
    s.time_ok = True
    s.call(B, "submit_work", 0, URL)
    s.time_ok = False
    fails(lambda: s.call(A, "dispute", 0), "time is unavailable")
    fails(lambda: s.call(B, "claim_after_review", 0), "time is unavailable")
    assert s.job(0)["status"] == "submitted"
    s.call(A, "approve", 0)  # actions that need no time still work
    assert s.job(0)["status"] == "paid"


@test
def approve_pays_freelancer_and_authorization():
    s = submitted()
    fails(lambda: s.call(B, "approve", 0), "only the client")
    fails(lambda: s.call(C, "approve", 0), "only the client")
    s.call(A, "approve", 0)
    assert s.job(0)["status"] == "paid" and s.credit(B) == ONE and s.credit(A) == 0
    fails(lambda: s.call(A, "approve", 0), "no submitted work")
    fails(lambda: s.call(A, "dispute", 0), "no submitted work")


@test
def dispute_is_blocked_after_the_review_window():
    s = submitted(review=100)
    s.clock += 99
    fails(lambda: s.call(B, "claim_after_review", 0), "has not ended")
    s.clock += 1  # exactly at the deadline: the freelancer's claim has matured
    fails(lambda: s.call(A, "dispute", 0), "review window has ended")
    assert s.job(0)["status"] == "submitted"
    s.call(B, "claim_after_review", 0)
    assert s.job(0)["status"] == "auto_paid" and s.credit(B) == ONE


@test
def dispute_inside_the_window_and_authorization():
    s = submitted(review=100)
    fails(lambda: s.call(B, "dispute", 0), "only the client")
    fails(lambda: s.call(C, "dispute", 0), "only the client")
    s.clock += 50
    s.call(A, "dispute", 0)
    j = s.job(0)
    assert j["status"] == "disputed" and j["disputed_at"] == s.clock
    fails(lambda: s.call(B, "claim_after_review", 0), "not waiting for review")
    fails(lambda: s.call(A, "claim_after_review", 0), "only the freelancer")


@test
def concede_refunds_client():
    s = submitted()
    fails(lambda: s.call(A, "concede", 0), "only the freelancer")
    s.call(B, "concede", 0)
    assert s.job(0)["status"] == "refunded" and s.credit(A) == ONE
    s2 = submitted(); s2.call(A, "dispute", 0); s2.call(B, "concede", 0)
    assert s2.credit(A) == ONE
    fails(lambda: s2.call(B, "concede", 0), "nothing to concede")


def disputed(page=PAGE):
    s = new()
    s.pages[URL] = page
    s.call(B, "submit_work", 0, URL)
    s.call(A, "dispute", 0)
    return s


@test
def resolve_accepted_requires_a_quote_present_in_the_evidence():
    s = disputed()
    s.llm = lambda p: json.dumps({"verdict": "accepted", "support_quote": "this faucet works: it sends test tokens"})
    fails(lambda: s.call(C, "withdraw"), "nothing to withdraw")
    assert s.call(C, "resolve", 0) == "accepted"  # anyone can resolve
    assert s.job(0)["status"] == "accepted" and s.credit(B) == ONE and s.credit(A) == 0
    s2 = disputed()  # a hallucinated acceptance with an invented quote is downgraded
    s2.llm = lambda p: json.dumps({"verdict": "accepted", "support_quote": "the faucet has been audited by experts"})
    assert s2.call(A, "resolve", 0) == "inconclusive"
    s3 = disputed()
    s3.llm = lambda p: json.dumps({"verdict": "accepted", "support_quote": ""})
    assert s3.call(A, "resolve", 0) == "inconclusive"


@test
def resolve_rejected_on_complete_evidence_refunds_client():
    s = disputed()
    s.llm = lambda p: json.dumps({"verdict": "rejected", "support_quote": ""})
    assert s.call(B, "resolve", 0) == "rejected"
    assert s.credit(A) == ONE and s.credit(B) == 0


@test
def rejection_on_truncated_evidence_becomes_inconclusive():
    s = disputed("word " * 5000)
    assert s.job(0)["evidence_truncated"] is True
    seen = []
    def model(prompt):
        seen.append(prompt)
        return json.dumps({"verdict": "rejected", "support_quote": ""})
    s.llm = model
    assert s.call(A, "resolve", 0) == "inconclusive"
    assert s.credit(A) == ONE // 2 and s.credit(B) == ONE - ONE // 2
    assert "only the first 6000" in seen[0], "the model must be told the evidence is partial"


@test
def garbage_or_failing_model_output_is_inconclusive():
    for out in ["", "I think it is good", "accepted and rejected", "{not json"]:
        s = disputed(); s.llm = lambda p, o=out: o
        assert s.call(A, "resolve", 0) == "inconclusive", out
    s = disputed()
    def boom(p): raise RuntimeError("llm down")
    s.llm = boom
    assert s.call(A, "resolve", 0) == "inconclusive"


@test
def resolve_only_when_disputed_and_never_twice():
    s = submitted()
    fails(lambda: s.call(A, "resolve", 0), "not disputed")
    s2 = disputed(); s2.llm = lambda p: '{"verdict": "rejected"}'
    s2.call(A, "resolve", 0)
    fails(lambda: s2.call(A, "resolve", 0), "not disputed")


@test
def odd_amounts_split_without_losing_dust():
    s = Sim(0, 0)
    s.pages[URL] = PAGE
    s.call(A, "create_job", "Odd", CRIT, B, "", value=ONE + 1)
    s.call(B, "submit_work", 0, URL); s.call(A, "dispute", 0)
    s.llm = lambda p: '{"verdict": "inconclusive"}'
    s.call(C, "resolve", 0)
    assert s.credit(A) + s.credit(B) == ONE + 1


@test
def unresolved_dispute_expires_into_a_split():
    s = disputed()
    fails(lambda: s.call(C, "claim_expired_dispute", 0), "not been reached")
    s.clock += 86400
    s.call(C, "claim_expired_dispute", 0)
    assert s.job(0)["status"] == "expired" and s.credit(A) + s.credit(B) == ONE
    fails(lambda: s.call(C, "claim_expired_dispute", 0), "not disputed")


@test
def withdraw_moves_real_funds_and_reconcile_confirms_delivery():
    s = submitted(); s.call(A, "approve", 0)
    fails(lambda: s.call(A, "withdraw"), "nothing to withdraw")
    s.call(B, "withdraw")
    assert s.wallets[B] == ONE and s.balance == 0 and s.credit(B) == 0  # the recipient wallet really gained the funds
    fails(lambda: s.call(B, "withdraw"), "nothing to withdraw")  # no duplicate payout
    assert s.call(C, "reconcile") == 1
    led = json.loads(s.obj.get_ledger())
    assert led["funds_in"] == ONE and led["confirmed_out"] == ONE and led["pending_transfers"] == 0 and led["unexplained_outflow"] == 0
    assert s.call(C, "reconcile") == 0  # idempotent


@test
def delayed_transfer_stays_pending_until_it_lands():
    s = submitted(); s.call(A, "approve", 0)
    s.hold_transfers = True
    s.call(B, "withdraw")
    assert s.wallets.get(B, 0) == 0 and s.balance == ONE
    assert s.call(C, "reconcile") == 0  # nothing has left yet
    fails(lambda: s.call(C, "recover_failed_transfer"), "grace period")
    s.deliver()
    assert s.wallets[B] == ONE
    assert s.call(C, "reconcile") == 1
    assert json.loads(s.obj.get_ledger())["pending_transfers"] == 0


@test
def failed_transfer_is_recovered_once_without_duplicates():
    s = submitted(); s.call(A, "approve", 0)
    s.hold_transfers = True
    s.call(B, "withdraw")
    s.drop()  # the transfer never arrives and the funds stay in the contract
    fails(lambda: s.call(C, "recover_failed_transfer"), "grace period")
    s.clock += 3600
    s.call(C, "recover_failed_transfer")
    assert s.credit(B) == ONE
    fails(lambda: s.call(C, "recover_failed_transfer"), "no pending")
    s.hold_transfers = False
    s.call(B, "withdraw")  # the retry pays exactly once
    assert s.wallets[B] == ONE and s.balance == 0
    assert s.call(C, "reconcile") >= 1
    fails(lambda: s.call(B, "withdraw"), "nothing to withdraw")


@test
def recovery_is_refused_when_funds_already_left_or_time_is_unknown():
    s = submitted(); s.call(A, "approve", 0)
    s.hold_transfers = True
    s.call(B, "withdraw"); s.deliver()  # delivered, but not yet reconciled
    s.clock += 7200
    fails(lambda: s.call(C, "recover_failed_transfer"), "funds have left")
    s2 = submitted(); s2.call(A, "approve", 0)
    s2.hold_transfers = True; s2.time_ok = False
    s2.call(B, "withdraw")  # withdrawing never depends on time; the entry's time is unknown
    s2.drop(); s2.time_ok = True; s2.clock += 7200
    fails(lambda: s2.call(C, "recover_failed_transfer"), "time is unknown")


@test
def late_delivery_after_recovery_is_detected_and_blocks_further_recovery():
    s = submitted(); s.call(A, "approve", 0)
    s.hold_transfers = True
    s.call(B, "withdraw")
    s.clock += 3600
    s.call(C, "recover_failed_transfer")  # looked failed, so it was re-credited
    s.deliver()  # ...but the original transfer lands late
    s.call(C, "reconcile")
    assert json.loads(s.obj.get_ledger())["unexplained_outflow"] == ONE  # the double payout risk is visible
    s.call(A, "create_job", "Second", CRIT, B, "", value=ONE)
    s.call(B, "withdraw")
    s.drop(); s.clock += 3600
    fails(lambda: s.call(C, "recover_failed_transfer"), "unexplained outflow")


@test
def unknown_ids_are_rejected_everywhere():
    s = new()
    for m in ("cancel_job", "approve", "dispute", "concede", "claim_after_review", "claim_expired_dispute", "resolve"):
        fails(lambda m=m: s.call(A, m, 99), "unknown job")
        fails(lambda m=m: s.call(A, m, -1), "unknown job")
    fails(lambda: s.obj.get_job(5), "unknown job")


@test
def full_money_flow_conserves_funds():
    s = Sim(0, 0); s.pages[URL] = PAGE
    for i in range(3):
        s.call(A, "create_job", f"J{i}", CRIT, B, "", value=ONE)
    s.call(A, "cancel_job", 0)
    s.call(B, "submit_work", 1, URL); s.call(A, "approve", 1)
    s.call(B, "submit_work", 2, URL); s.call(B, "concede", 2)
    s.call(A, "withdraw"); s.call(B, "withdraw")
    assert s.wallets[A] == 2 * ONE and s.wallets[B] == ONE and s.balance == 0
    solvent(s)


@test
def fallback_clock_is_used_when_the_runtime_gives_no_time():
    s = new(review=600)
    s.time_ok = False; s.web_clock = True
    s.clock += 123  # not on a 5 minute boundary
    s.call(B, "submit_work", 0, URL)
    t0 = s.job(0)["submitted_at"]
    assert t0 % 300 == 0 and 0 <= (s.clock - t0) < 300  # rounded DOWN to the bucket, never invented
    fails(lambda: s.call(B, "claim_after_review", 0), "has not ended")
    s.clock += 1200
    s.call(B, "claim_after_review", 0)
    assert s.job(0)["status"] == "auto_paid"


@test
def fallback_clock_accepts_the_second_public_clock_and_fails_safely_without_any():
    s = new()
    s.time_ok = False; s.web_clock = True; s.clock_format = "timeapi"
    s.call(B, "submit_work", 0, URL)
    assert s.job(0)["submitted_at"] % 300 == 0
    s2 = new()
    s2.time_ok = False; s2.web_clock = True; s2.clock_format = "none"  # both clocks down
    fails(lambda: s2.call(B, "submit_work", 0, URL), "time is unavailable")
    assert s2.job(0)["status"] == "funded"


@test
def withdraw_never_needs_the_clock():
    s = submitted(); s.call(A, "approve", 0)
    s.time_ok = False; s.web_clock = False
    s.call(B, "withdraw")
    assert s.wallets[B] == ONE


print(f"\nall {passed} behavioural tests passed")
