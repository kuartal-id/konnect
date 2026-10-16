"""
Builds server/docker-compose.yml from compose.template.yml by embedding setup.py, the discovery
module and the sign-in page templates, so the server is ONE file that can be pasted into
Hostinger's Docker Manager (no repo checkout, no build step on the VPS).

  python3 server/build_compose.py          # write docker-compose.yml
  python3 server/build_compose.py --check  # CI: fail if docker-compose.yml is out of date
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "server" / "compose.template.yml"
OUTPUT = ROOT / "server" / "docker-compose.yml"
INDENT = " " * 6


def embed(match: re.Match) -> str:
    text = (ROOT / match.group(1)).read_text()
    # Compose interpolates ${...} and $NAME inside config content: escape every $ as $$.
    text = text.replace("$", "$$")
    return "\n".join((INDENT + line) if line.strip() else "" for line in text.rstrip("\n").split("\n"))


def build() -> str:
    return re.sub(r"^@@FILE (\S+)@@$", embed, TEMPLATE.read_text(), flags=re.M)


if __name__ == "__main__":
    result = build()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text() != result:
            sys.exit("server/docker-compose.yml is out of date. Run: python3 server/build_compose.py")
        print("server/docker-compose.yml is up to date.")
    else:
        OUTPUT.write_text(result)
        print(f"Wrote {OUTPUT.relative_to(ROOT)}")
