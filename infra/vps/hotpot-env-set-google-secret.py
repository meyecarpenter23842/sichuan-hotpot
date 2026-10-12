#!/usr/bin/python3
"""Accept the existing secret through stdin only; never print its value."""
import os
from pathlib import Path
import re
import sys
import tempfile


def main():
    if os.geteuid() != 0:
        os.execvp("sudo", ["sudo", "-n", str(Path(__file__).resolve())])
    secret = sys.stdin.read(4097).strip()
    if not re.fullmatch(r"GOCSPX-[A-Za-z0-9_-]{10,200}", secret):
        raise ValueError("invalid_secret_input")
    target = Path("/etc/sichuan-hotpot/api.env")
    st = target.stat()
    lines = [line for line in target.read_text().splitlines()
             if not line.startswith("GOOGLE_CLIENT_SECRET=")]
    fd, temporary = tempfile.mkstemp(dir=target.parent)
    try:
        os.fchmod(fd, 0o640)
        os.fchown(fd, st.st_uid, st.st_gid)
        with os.fdopen(fd, "w") as output:
            output.write("\n".join(lines) + "\nGOOGLE_CLIENT_SECRET=" + secret + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("google_secret_configured=PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("google_secret_configuration=FAIL", file=sys.stderr)
        sys.exit(1)
