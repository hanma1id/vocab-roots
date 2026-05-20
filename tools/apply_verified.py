# ============================================================
# apply_verified.py — 어원별 검수 완료 플래그(verified)를 일괄 적용
# ------------------------------------------------------------
#   verified=true 인 어원만 사용자에게 노출된다.
#   새 어원을 손으로 검수했으면 아래 VERIFIED_IDS에 추가하고
#   이 스크립트를 다시 돌리면 된다.
# ============================================================

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
from sync_index import sync_all  # noqa: E402

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"

# 손으로 검수 완료한 어원 — 메인 화면에 보임
VERIFIED_IDS: set[str] = {
    # 처음에 손으로 만든 15개
    "spec", "dict", "port", "tract", "ject",
    "scrib", "ven", "ced", "pos", "mit",
    "voc", "flex", "graph", "log", "phon",
    # 2026-05-21 자동검증 통과 8개
    "cred",                              # 검증 OK
    "aud", "sci", "ten", "vid",          # 분류 정확 (누락만 있음)
    "chrom", "therm", "geo",             # 손수정 완료
}


def main() -> int:
    changed = 0
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        want = data["id"] in VERIFIED_IDS
        if data.get("verified") == want:
            continue
        data["verified"] = want
        fp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        mark = "✓" if want else "·"
        print(f"  {mark} {data['id']:8} verified={want}")
        changed += 1

    if changed:
        sync_all()
    print(f"\n총 {changed}개 변경. 검수 완료 {len(VERIFIED_IDS)}개.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
