# ============================================================
# apply_clusters.py — 어원별 의미 클러스터를 일괄 지정
# ------------------------------------------------------------
# 이미 만들어진 어원 JSON 파일들에 cluster 필드를 채워 넣는다.
# 새 어원을 추가할 때마다 매핑 표를 갱신만 하면 된다.
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

# 어원 → 클러스터 매핑 (확장하면서 여기에 추가)
CLUSTER_MAP: dict[str, str] = {
    # 시각
    "spec": "시각",
    "vid":  "시각",
    # 청각·소리
    "aud":  "청각·소리",
    "phon": "청각·소리",
    # 말·언어
    "dict": "말·언어",
    "voc":  "말·언어",
    "log":  "말·언어",
    # 쓰다·기록
    "scrib": "쓰다·기록",
    "graph": "쓰다·기록",
    # 가다·이동
    "ced":  "가다·이동",
    "ven":  "가다·이동",
    "duc":  "가다·이동",
    # 운반·던지다
    "port":  "운반·던지다",
    "tract": "운반·던지다",
    "ject":  "운반·던지다",
    "mit":   "운반·던지다",
    "fer":   "운반·던지다",
    # 손·잡다·놓다
    "man":  "손·잡다·놓다",
    "cap":  "손·잡다·놓다",
    "ten":  "손·잡다·놓다",
    "pos":  "손·잡다·놓다",
    # 생명·호흡·정신
    "bio":  "생명·호흡·정신",
    "spir": "생명·호흡·정신",
    "sci":  "생명·호흡·정신",
    "cred": "생명·호흡·정신",
    # 자연·사물
    "therm": "자연·사물",
    "hydr":  "자연·사물",
    "chrom": "자연·사물",
    "aster": "자연·사물",
    "geo":   "자연·사물",
    # 형태·변형
    "flex": "형태·변형",
}


def main() -> int:
    changed = 0
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        want = CLUSTER_MAP.get(data["id"])
        if want is None:
            print(f"  · {data['id']:8} — 매핑 없음, 건너뜀")
            continue
        if data.get("cluster") == want:
            print(f"  · {data['id']:8} — 이미 {want}")
            continue
        data["cluster"] = want
        fp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  ✓ {data['id']:8} → {want}")
        changed += 1

    if changed:
        sync_all()
    print(f"\n총 {changed}개 어원에 cluster 입력 완료.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
