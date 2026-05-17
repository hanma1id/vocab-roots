# ============================================================
# add_root.py — 새 어원 한 개를 Gemini로 만들어 추가
# ------------------------------------------------------------
# 사용 예
#   python tools/add_root.py --id spir --form "spir-, spire-" \
#       --meaning "숨쉬다" --origin Latin --cluster "생명·호흡·정신" --words 12
#
# 인자를 안 주면 대화형으로 물어본다.
# ============================================================

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

# Windows cp949 콘솔에서 em-dash 등이 깨지지 않도록 stdout을 UTF-8로
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 자체 모듈 import 가능하도록 부모 경로 추가
sys.path.insert(0, str(Path(__file__).parent))

from gemini_client import generate_root  # noqa: E402
from sync_index import sync_all          # noqa: E402

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"


def _prompt(label: str, default: str = "") -> str:
    """대화형 입력 — 빈 값이면 기본값 사용."""
    suffix = f" [{default}]" if default else ""
    val = input(f"{label}{suffix} > ").strip()
    return val or default


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Gemini로 어원 한 개 추가")
    p.add_argument("--id", help="어원 id (영문, 파일명에 사용)")
    p.add_argument("--form", help="어원 표면형 (예 'spir-, spire-')")
    p.add_argument("--meaning", help="한국어 의미")
    p.add_argument("--origin", choices=["Latin", "Greek"], help="원어")
    p.add_argument("--cluster", default="", help="의미 클러스터")
    p.add_argument("--words", type=int, default=12, help="목표 단어 수 (기본 12)")
    p.add_argument("--overwrite", action="store_true",
                   help="이미 같은 id 파일이 있어도 덮어쓰기")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    # 누락된 값은 대화형으로 채운다
    root_id = args.id or _prompt("어원 id (영문)")
    if not root_id:
        print("어원 id는 필수입니다.")
        return 1

    form = args.form or _prompt("어원 표면형", f"{root_id}-")
    meaning = args.meaning or _prompt("한국어 의미")
    origin = args.origin or _prompt("원어 (Latin/Greek)", "Latin")
    cluster = args.cluster or _prompt("의미 클러스터", "")
    target_words = args.words

    if origin not in {"Latin", "Greek"}:
        print(f"origin은 Latin/Greek만 가능 — {origin}")
        return 1

    out_path = ROOTS_DIR / f"{root_id}.json"
    if out_path.exists() and not args.overwrite:
        print(f"파일이 이미 있습니다 — {out_path}\n"
              "  덮어쓰려면 --overwrite, 단어 추가는 expand_root.py 를 쓰세요.")
        return 1

    print(f"\n[add_root] 생성 시작 — {root_id} ({form}, {meaning}) "
          f"× {target_words} 단어")
    data = generate_root(
        root_id=root_id,
        root_form=form,
        meaning=meaning,
        origin=origin,
        cluster=cluster,
        target_words=target_words,
    )

    ROOTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    word_count = sum(len(s["words"]) for s in data["tree"])
    print(f"[add_root] 저장 — {out_path} (단어 {word_count}개)")

    # 인덱스·접두어·캐시 자동 동기화
    sync_all()

    # 검수 체크리스트 출력
    print("\n--- 검수 체크리스트 ---")
    for section in data["tree"]:
        print(f"\n  [{section.get('prefix')}] {section.get('prefixMeaning')}")
        for w in section["words"]:
            print(f"    - {w['word']:18} {w['ipa']:18} {w['meaning']}")
    print("\n위 내용을 한 번 훑어보고 어색한 단어가 있으면 JSON을 직접 수정하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
