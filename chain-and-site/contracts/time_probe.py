# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class TimeProbe(gl.Contract):
    seen: str

    def __init__(self):
        self.seen = ""

    @gl.public.write
    def stamp(self) -> None:
        try:
            self.seen = str(gl.message_raw["datetime"])
        except Exception:
            self.seen = "UNAVAILABLE"

    @gl.public.view
    def get_seen(self) -> str:
        return self.seen
