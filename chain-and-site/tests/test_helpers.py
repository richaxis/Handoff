"""Verifies the contract's pure helpers (SHA-256, time math, verdict parsing) against Python's reference code."""
import ast, hashlib, pathlib, datetime, random

src = (pathlib.Path(__file__).parent.parent / "contracts" / "handoff.py").read_text()
tree = ast.parse(src)
keep = {"_norm", "_ror", "_sha256_hex", "_unix", "_parse_clock", "_parse_judgement", "_final_verdict"}
nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in keep)
         or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") in ("_K", "VERDICTS"))]
ns = {"json": __import__("json")}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "helpers", "exec"), ns)

# SHA-256 must match hashlib for many lengths (padding edge cases at 55, 56, 63, 64, 119, 120 bytes)
random.seed(1)
for n in list(range(0, 130)) + [500, 1000]:
    s = "".join(random.choice("abc é中 ") for _ in range(n))
    assert ns["_sha256_hex"](s) == hashlib.sha256(s.encode()).hexdigest(), f"sha256 mismatch at {n}"

# time math must match datetime for the format GenLayer sends
for iso in ["2026-09-27T09:14:14.081651Z", "2026-10-09T09:42:35.000000Z", "2024-02-29T23:59:59.999999Z", "2000-01-01T00:00:00.000000Z", "2026-03-01T00:00:00.000000Z"]:
    expected = int(datetime.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp())
    assert ns["_unix"](iso) == expected, iso

p, fv = ns["_parse_judgement"], ns["_final_verdict"]
assert p('{"verdict": "accepted", "support_quote": "works fine"}') == ("accepted", "works fine")
assert p("```json\n{\"verdict\":\"rejected\"}\n```") == ("rejected", "")
assert p("Accepted.") == ("accepted", "")
assert p("it is accepted and rejected") == ("inconclusive", "")
assert p("") == ("inconclusive", "")
assert ns["_norm"]("  A  b\nC ") == "a b c"
ex = "the faucet works and sends tokens"
assert fv("accepted", "faucet works and sends", ex, False) == "accepted"
assert fv("accepted", "invented claim text", ex, False) == "inconclusive"
assert fv("accepted", "short", ex, False) == "inconclusive"
assert fv("rejected", "", ex, False) == "rejected"
assert fv("rejected", "", ex, True) == "inconclusive"
assert ns["_parse_clock"]('{"abbreviation":"UTC","unixtime": 1800000123,"x":1}') == 1800000123
assert ns["_parse_clock"]('{"dateTime":"2027-01-15T08:00:00.1234567","timeZone":"UTC"}') == 1800000000
assert ns["_parse_clock"]("<html>no clock</html>") == 0
assert ns["_parse_clock"]('{"unixtime": 12}') == 0
print("helper checks passed (sha256, time math, verdict parsing and guard rails)")
