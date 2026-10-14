"""Static checks that need no GenLayer install: run `make test`."""
import ast, pathlib, sys

src = (pathlib.Path(__file__).parent.parent / "contracts" / "handoff.py").read_text()
lines = src.splitlines()
errors = []

if not lines[0].startswith("# v0.2.16"): errors.append("line 1 must be the # v0.2.16 version header")
if "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" not in lines[1] or ":latest" in lines[1]: errors.append("line 2 must pin the Studio runner hash")
if "from genlayer import *" not in src: errors.append("use `from genlayer import *` (Studio style)")

tree = ast.parse(src)
contracts = [c for c in tree.body if isinstance(c, ast.ClassDef)
             and any(ast.unparse(b) == "gl.Contract" for b in c.bases)]
if len(contracts) != 1: errors.append("exactly one gl.Contract class is required")
else:
    for fn in [f for f in contracts[0].body if isinstance(f, ast.FunctionDef)]:
        public = any("gl.public" in ast.unparse(d) for d in fn.decorator_list)
        if public and fn.returns is None: errors.append(f"{fn.name}: public methods need a return annotation")
        if fn.name.startswith("_") and fn.name != "__init__" and public: errors.append(f"{fn.name}: private but public")
    names = {f.name for f in contracts[0].body if isinstance(f, ast.FunctionDef)}
    for need in ("create_job", "cancel_job", "submit_work", "approve", "dispute", "concede", "claim_after_review", "claim_expired_dispute", "resolve", "withdraw", "reconcile", "recover_failed_transfer", "get_job", "get_job_count", "get_credit", "get_ledger", "get_config"):
        if need not in names: errors.append(f"missing method {need}")

for bad in ("import time", "import random", "import os", "import datetime", "from datetime", "hashlib"):
    if bad in src: errors.append(f"forbidden/unsafe in contract: {bad}")
if "gl.message_raw" not in src: errors.append("timeout recovery needs gl.message_raw time")
if "def _now(" in src: errors.append("a time helper that can return 0 must not be used for stored timestamps")

if errors: print("FAIL\n" + "\n".join(errors)); sys.exit(1)
print("handoff.py static checks passed")
