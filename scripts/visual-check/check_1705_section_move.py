#!/usr/bin/env python3
"""구역 이동의 화면과 초점, 좁은 폭을 브라우저에서 확인한다."""
import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".local/visual/card1705")
    parser.add_argument("--port", type=int, default=5706)
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["KS_E2E_PORT"] = str(args.port)
    env["KS_1705_VISUAL_OUTPUT"] = str(output)
    result = subprocess.run(["corepack", "pnpm@10.32.1", "--dir", "ui", "e2e:netns", "section-move-1705", "--workers=1"], cwd=ROOT, env=env, timeout=840, check=False)
    missing = [f"{width}-{state}.png" for width in (1280, 360) for state in ("normal", "before", "after", "dropped", "menu", "expanded-after", "expanded-dropped", "next-before", "first-before") if not (output / f"{width}-{state}.png").is_file()]
    missing += [name for name in ("360-long-header.png", "1280-plus-before.png", "1280-plus-after.png") if not (output / name).is_file()]
    missing += [f"360-gap-{gap}-{position}.png" for gap in ("none", "omitted") for position in ("before", "after") if not (output / f"360-gap-{gap}-{position}.png").is_file()]
    missing += [f"{width}-{surface}-titles.png" for width in (1280, 360) for surface in ("chat", "settings") if not (output / f"{width}-{surface}-titles.png").is_file()]
    status = "통과" if result.returncode == 0 and not missing else "미통과"
    summary = {"시험_종료코드": result.returncode, "누락_캡처": missing,
               "14_누른_뒤_초점": status, "15_Tab_Esc": status, "16_최소_폭_넘침과_겹침": status,
               "17_오류_상태": "해당 없음: 새 오류 표시 없음", "18_창_크기와_입력_유지": status}
    (output / "result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return int(bool(result.returncode or missing))


if __name__ == "__main__":
    raise SystemExit(main())
