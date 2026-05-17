# ============================================================
# expand_root.py — 기존 어원의 단어 수를 늘림
# ------------------------------------------------------------
# 사용 예
#   python tools/expand_root.py --id spec --target 12
#   python tools/expand_root.py --all --target 12   # 전체 어원을 12개로
# ============================================================

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))

from gemini_client import expand_words   # noqa: E402
from sync_index import sync_all          # noqa: E402

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"


def expand_one(path: Path, target: int) -> bool:
    """한 어원 파일을 확장. 이미 충분하면 건너뛰고 False 반환."""
    existing = json.loads(path.read_text(encoding="utf-8"))
    have = sum(len(s.get("words", [])) for s in existing.get("tree", []))
    if have >= target:
        print(f"  · {existing['id']:8} — 이미 {have}개, 건너뜀")
        return False

    print(f"  · {existing['id']:8} — {have}개 → {target}개 확장 중…")
    try:
        new_data = expand_words(existing, target_total=target)
    except Exception as e:
        print(f"    ✗ 실패 — {e}")
        return False

    path.write_text(
        json.dumps(new_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    new_count = sum(len(s["words"]) for s in new_data["tree"])
    print(f"    ✓ 저장 — {new_count}개")
    return True


def main() -> int:
    p = argparse.ArgumentParser(description="기존 어원 단어 수 확장")
    p.add_argument("--id", help="어원 id (없으면 --all 필요)")
    p.add_argument("--all", action="store_true", help="모든 어원을 일괄 확장")
    p.add_argument("--target", type=int, default=12, help="목표 단어 수")
    p.add_argument("--sleep", type=float, default=1.0,
                   help="요청 사이 대기 (초). API 레이트 회피")
    args = p.parse_args()

    if not args.all and not args.id:
        p.error("--id 또는 --all 중 하나는 필요")

    targets: list[Path]
    if args.all:
        targets = sorted(ROOTS_DIR.glob("*.json"))
    else:
        targets = [ROOTS_DIR / f"{args.id}.json"]
        if not targets[0].exists():
            print(f"파일이 없습니다 — {targets[0]}")
            return 1

    print(f"[expand] {len(targets)}개 어원을 단어 {args.target}개로 확장")
    changed = 0
    for i, path in enumerate(targets):
        if expand_one(path, args.target):
            changed += 1
        if i < len(targets) - 1:
            time.sleep(args.sleep)

    print(f"\n[expand] 완료 — {changed}/{len(targets)}개 변경됨")

    if changed:
        sync_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
