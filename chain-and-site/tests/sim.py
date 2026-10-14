"""A small GenLayer simulator: runs the REAL contract file against stubbed `genlayer` modules.
Each call is atomic (state and balances roll back on any exception), value moves like a real chain,
outgoing transfers can be held, delivered or dropped, and time / web pages / the LLM are scriptable."""
import copy, datetime, importlib.util, pathlib, sys, types
from types import SimpleNamespace as NS


class UserError(Exception):
    pass


class Address:
    def __init__(self, v):
        s = (v.as_hex if isinstance(v, Address) else str(v)).lower()
        if not (s.startswith("0x") and len(s) == 42):
            raise ValueError("bad address")
        int(s, 16)
        self.as_hex = s

    def __eq__(self, o): return isinstance(o, Address) and o.as_hex == self.as_hex
    def __hash__(self): return hash(self.as_hex)


class TreeMap(dict):
    def __class_getitem__(cls, item): return cls


def _mark(kind):
    def deco(fn):
        fn._kind = kind
        return fn
    return deco


CLOCK_WORLD = "https://worldtimeapi.org/api/timezone/Etc/UTC"
CLOCK_TIMEAPI = "https://timeapi.io/api/Time/current/zone?timeZone=UTC"


class Sim:
    CONTRACT = pathlib.Path(__file__).parent.parent / "contracts" / "handoff.py"

    def __init__(self, *ctor_args):
        self.clock = 1_800_000_000
        self.time_ok = True
        self.web_clock = False
        self.clock_format = "worldtime"
        self.balance = 0
        self.wallets = {}
        self.pages = {}
        self.llm = lambda prompt: '{"verdict": "inconclusive", "support_quote": ""}'
        self.hold_transfers = False
        self.in_flight = []
        self.queue = []
        self._install_stubs()
        spec = importlib.util.spec_from_file_location("handoff_contract", self.CONTRACT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.mod = mod
        cls = mod.Handoff
        obj = object.__new__(cls)
        for name, ann in cls.__annotations__.items():
            setattr(obj, name, TreeMap() if ann is TreeMap else 0)
        sim = self
        cls.balance = property(lambda self_: sim.balance)  # the contract can read its own balance
        self.obj = obj
        self._run(lambda: cls.__init__(obj, *ctor_args), "0x" + "d" * 40, 0)

    # ----- stubs -----
    def _install_stubs(self):
        sim = self
        gl = NS()
        gl.Contract = object
        write = _mark("write"); write.payable = _mark("payable")
        gl.public = NS(write=write, view=_mark("view"))

        def contract_interface(cls):
            class Proxy:
                def __init__(self, addr): self.addr = addr
                def emit_transfer(self, value=0): sim.queue.append((self.addr.as_hex, int(value)))
            return Proxy
        gl.evm = NS(contract_interface=contract_interface)
        gl.vm = NS(UserError=UserError)

        def render(url, mode="text"):
            if sim.web_clock and url in (CLOCK_WORLD, CLOCK_TIMEAPI):  # a public clock the contract may use as a fallback
                if url == CLOCK_WORLD and sim.clock_format == "worldtime":
                    return '{"abbreviation":"UTC","unixtime": %d,"utc_offset":"+00:00"}' % sim.clock
                if url == CLOCK_TIMEAPI and sim.clock_format == "timeapi":
                    return '{"year":2027,"dateTime":"%s.1234567","timeZone":"UTC"}' % self._iso()[:19]
                raise RuntimeError("clock unavailable")
            if url not in sim.pages or sim.pages[url] is None:
                raise RuntimeError("fetch failed")
            return sim.pages[url]
        gl.nondet = NS(web=NS(render=render), exec_prompt=lambda p: sim.llm(p))
        gl.eq_principle = NS(strict_eq=lambda fn: fn())
        gl.message = NS(sender_address=None, value=0)
        gl.message_raw = {}
        mod = types.ModuleType("genlayer")
        mod.gl, mod.Address, mod.u256, mod.TreeMap = gl, Address, int, TreeMap
        sys.modules["genlayer"] = mod
        sys.modules.pop("genlayer.types", None)
        self.gl = gl

    # ----- execution -----
    def _iso(self):
        return datetime.datetime.fromtimestamp(self.clock, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000000Z")

    def _run(self, fn, sender, value):
        snap, bal, wallets = copy.deepcopy(self.obj.__dict__), self.balance, dict(self.wallets)
        self.gl.message = NS(sender_address=Address(sender), value=value)
        self.gl.message_raw = {"datetime": self._iso()} if self.time_ok else {}
        self.queue = []
        self.balance += value
        try:
            result = fn()
            moved = []
            for to, v in self.queue:
                if v > self.balance:
                    raise UserError("insufficient contract balance")
                moved.append((to, v))
            if self.hold_transfers:
                self.in_flight += moved
            else:
                for to, v in moved:
                    self.balance -= v
                    self.wallets[to] = self.wallets.get(to, 0) + v
            return result
        except Exception:
            self.obj.__dict__.clear(); self.obj.__dict__.update(snap)
            self.balance, self.wallets = bal, wallets
            raise

    def call(self, sender, method, *args, value=0):
        return self._run(lambda: getattr(self.obj, method)(*args), sender, value)

    def deliver(self, index=0):
        to, v = self.in_flight.pop(index)
        self.balance -= v
        self.wallets[to] = self.wallets.get(to, 0) + v

    def drop(self, index=0):
        self.in_flight.pop(index)

    def job(self, i):
        import json
        return json.loads(self.obj.jobs[i])

    def credit(self, who):
        return int(self.obj.credits.get(Address(who), 0))
