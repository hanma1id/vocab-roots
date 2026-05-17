# ============================================================
# seed_new_roots.py — 미리 정의된 새 어원 묶음을 한 번에 생성
# ------------------------------------------------------------
# add_root.py를 어원마다 호출하는 대신, 묶음으로 실행해 시간 절약.
# 이미 있는 어원은 건너뛴다.
# ============================================================

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
import argparse

from gemini_client import generate_root, DEFAULT_MODEL  # noqa: E402
from sync_index import sync_all                          # noqa: E402

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"

# 추가할 어원 목록 — (id, rootForm, meaning, origin, cluster)
NEW_ROOTS: list[tuple[str, str, str, str, str]] = [
    # 청각 - 소리
    ("aud",   "aud-, audi-",        "듣다",         "Latin", "청각·소리"),
    # 가다·이동
    ("duc",   "duc-, duct-",        "이끌다",       "Latin", "가다·이동"),
    # 운반·던지다
    ("fer",   "fer-, lat-",         "나르다",       "Latin", "운반·던지다"),
    # 손·잡다·놓다
    ("man",   "man-, manu-",        "손",           "Latin", "손·잡다·놓다"),
    ("cap",   "cap-, cept-, cip-",  "잡다",         "Latin", "손·잡다·놓다"),
    ("ten",   "ten-, tain-",        "잡다, 유지하다","Latin", "손·잡다·놓다"),
    # 생명·호흡·정신
    ("spir",  "spir-, spire-",      "숨쉬다",       "Latin", "생명·호흡·정신"),
    ("sci",   "sci-",               "알다",         "Latin", "생명·호흡·정신"),
    ("cred",  "cred-",              "믿다",         "Latin", "생명·호흡·정신"),
    ("bio",   "bio-",               "생명",         "Greek", "생명·호흡·정신"),
    # 자연·사물
    ("therm", "therm-, thermo-",    "열",           "Greek", "자연·사물"),
    ("hydr",  "hydr-, hydro-",      "물",           "Greek", "자연·사물"),
    ("chrom", "chrom-, chromo-",    "색",           "Greek", "자연·사물"),
    ("aster", "aster-, astro-",     "별",           "Greek", "자연·사물"),
    ("geo",   "geo-",               "땅, 지구",     "Greek", "자연·사물"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help="사용할 Gemini 모델. 무료 한도 초과 시 "
                             "'gemini-2.5-flash-lite' 시도")
    parser.add_argument("--sleep", type=float, default=1.5)
    args = parser.parse_args()

    print(f"[seed] {len(NEW_ROOTS)}개 어원 생성 시작 (model={args.model})")
    created = 0
    skipped = 0
    for i, (rid, form, meaning, origin, cluster) in enumerate(NEW_ROOTS):
        out_path = ROOTS_DIR / f"{rid}.json"
        if out_path.exists():
            print(f"  · {rid:8} 이미 존재, 건너뜀")
            skipped += 1
            continue
        print(f"  · {rid:8} 생성 중… ({form} / {meaning})")
        try:
            data = generate_root(
                root_id=rid, root_form=form, meaning=meaning,
                origin=origin, cluster=cluster, target_words=12,
                model=args.model,
            )
        except Exception as e:
            print(f"    ✗ 실패 — {e}")
            continue
        out_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        wc = sum(len(s["words"]) for s in data["tree"])
        print(f"    ✓ 저장 ({wc} words)")
        created += 1
        if i < len(NEW_ROOTS) - 1:
            time.sleep(args.sleep)

    print(f"\n[seed] 완료 — 생성 {created}, 건너뜀 {skipped}")
    if created:
        sync_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
