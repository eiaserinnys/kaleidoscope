"""리로드·역압 시험에 쓰는 번호 붙은 출력 스트림."""
import os
import subprocess
import sys
import time
from pathlib import Path

if len(sys.argv) > 1:
    time.sleep(120)
    raise SystemExit

child = subprocess.Popen([sys.executable, __file__, "descendant"])
Path("pids.txt").write_text(f"{os.getpid()} {child.pid}", encoding="utf-8")
progress = Path("progress.txt")
number = 0
while True:
    if Path("pause").exists():
        Path("paused.txt").write_text(str(number), encoding="utf-8")
        while Path("pause").exists():
            time.sleep(0.01)
    line = f"{os.getpid()}|{number}|" + "x" * 180 + "\n"
    data = line.encode("ascii")
    os.write(1, data[:7])
    if not Path("burst").exists():
        time.sleep(0.0001)
    os.write(1, data[7:])
    number += 1
    if Path("burst").exists() or number % 500 == 0:
        progress.write_text(str(number), encoding="utf-8")
    if number % 100 == 0 and not Path("burst").exists():
        time.sleep(0.05)
