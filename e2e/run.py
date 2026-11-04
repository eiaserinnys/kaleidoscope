"""공용 시험 쉘의 지정 커밋에서 창 제어 시나리오를 실행한다."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", required=True, help="시험할 커밋")
    parser.add_argument("--out", required=True, help="화면과 결과를 저장할 폴더")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    sandbox = Path(os.environ["AGENT_COMMON_FILES_DIR"]) / "skills/kaleidoscope-app/scripts/sandbox.py"
    subprocess.run([sys.executable, str(sandbox), "prepare", "--ref", args.ref], check=True, timeout=580)
    subprocess.run([sys.executable, str(sandbox), "run", "--ref", args.ref,
                    "--app", str(root / "scenarios/window-control-app.json"),
                    "--scenario", str(root / "scenarios/window-control.py"), "--out", args.out],
                   check=True, timeout=400)
    result = json.loads((Path(args.out) / "result.json").read_text(encoding="utf-8"))
    if result.get("scenario_error"):
        raise RuntimeError(result["scenario_error"])


if __name__ == "__main__":
    main()
