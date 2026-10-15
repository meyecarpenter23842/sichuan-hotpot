#!/usr/bin/env python3
"""No writes and no secrets: production OSRM capacity preflight."""
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess

def meminfo():
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        k, _, v = line.partition(":")
        if k in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
            values[k] = int(v.strip().split()[0]) // 1024
    return values

def status():
    mem = meminfo()
    disk = shutil.disk_usage("/opt/sichuan-hotpot")
    root = shutil.disk_usage("/")
    cpu = os.cpu_count() or 0
    print("architecture=" + platform.machine())
    print("cpu_count=" + str(cpu))
    for k in ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree"):
        print(k.lower() + "_mib=" + str(mem.get(k, 0)))
    print("osrm_volume_free_mib=" + str(disk.free // 1024 // 1024))
    print("root_volume_free_mib=" + str(root.free // 1024 // 1024))
    for svc in ("hotpot-api.service", "postgresql.service", "docker.service", "containerd.service"):
        probe = subprocess.run(["/usr/bin/systemctl", "is-active", svc], capture_output=True, text=True, timeout=5)
        print(svc.replace(".service", "").replace("-", "_") + "=" + ("ACTIVE" if probe.stdout.strip() == "active" else "NOT_ACTIVE"))
    for label, port in (("api_port", 3000), ("postgres_port", 5432), ("osrm_port", 5000)):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2)
        try:
            busy = s.connect_ex(("127.0.0.1", port)) == 0
        finally:
            s.close()
        print(label + "=" + ("IN_USE" if busy else "FREE"))
    # Passing this gate is not proof that a country-scale dataset can be safely preprocessed.
    ready = (cpu >= 2 and mem.get("MemAvailable", 0) >= 2048
             and mem.get("MemTotal", 0) >= 4096 and disk.free >= 10 * 1024 ** 3
             and root.free >= 1024 ** 3)
    print("full_vietnam_on_vps_preprocess_gate=" + ("CANDIDATE" if ready else "BLOCKED"))
    print("assessment=READ_ONLY")

if __name__ == "__main__":
    status()
