# ============================================================
# apply_steps.py — 어원별 학습 단계(step 1/2/3)를 일괄 지정
# ------------------------------------------------------------
# 메인 화면을 단계별 섹션으로 보여주기 위함.
# 새 어원 검수가 끝나서 노출시킬 때 여기 매핑 표를 갱신만 하면 됨.
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

# 어원 → 학습 단계 매핑
#   1 = 기초 (중1~2 수준)
#   2 = 중급 (중3~고1 수준)
#   3 = 고급 (고2~수능 수준)
STEP_MAP: dict[str, int] = {
    # Step 1 — 익숙한 단어 위주
    "port":  1,
    "dict":  1,
    "spec":  1,
    "graph": 1,
    "phon":  1,
    # Step 2 — 자주 쓰지만 추상 의미가 섞임
    "log":   2,
    "ven":   2,
    "mit":   2,
    "ject":  2,
    "pos":   2,
    # Step 3 — 좀 더 추상적이고 수능 빈출
    "voc":   3,
    "scrib": 3,
    "ced":   3,
    "tract": 3,
    "flex":  3,
}


def main() -> int:
    changed = 0
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        want = STEP_MAP.get(data["id"])
        if want is None:
            # 매핑 없는 어원은 step 제거 (자동생성 미검수 등)
            if "step" in data:
                del data["step"]
                fp.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                print(f"  · {data['id']:8} step 제거")
                changed += 1
            continue
        if data.get("step") == want:
            continue
        data["step"] = want
        fp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  ✓ {data['id']:8} step={want}")
        changed += 1

    if changed:
        sync_all()
    print(f"\n총 {changed}개 변경.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
