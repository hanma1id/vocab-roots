# ============================================================
# build_glossary.py — 유의어·반의어로 등장하는 단어들의 사전 빌드
# ------------------------------------------------------------
# 어원 JSON의 모든 synonyms/antonyms 단어 중
# 우리 단어 인덱스(words.json)에 없는 것들을 모아
# Gemini로 IPA·한국어 뜻을 받아 data/glossary.json에 저장.
#
# Gemini 무료 한도(25/일)를 아끼기 위해 한 번에 여러 단어를 묶어 요청한다.
#
# 사용
#   python tools/build_glossary.py            # 누락분만 새로 채움
#   python tools/build_glossary.py --rebuild  # 전체 다시 만듦
# ============================================================

from __future__ import annotations

import argparse
import glob
import io
import json
import re
import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
from gemini_client import _load_api_key, DEFAULT_MODEL  # noqa: E402
from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"
GLOSSARY_PATH = ROOT / "data" / "glossary.json"
WORDS_PATH = ROOT / "data" / "words.json"

BATCH_SIZE = 50


def collect_targets() -> tuple[set[str], dict]:
    """유의어/반의어로 등장하는 모든 단어를 모은다.
    words.json에 이미 있는 건 사전에 넣을 필요 없음 (UI에서 그쪽을 우선)."""
    known: dict[str, dict] = {}
    if WORDS_PATH.exists():
        for w in json.loads(WORDS_PATH.read_text(encoding="utf-8")):
            known[w["w"].lower()] = w

    related: set[str] = set()
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        d = json.loads(fp.read_text(encoding="utf-8"))
        if not d.get("verified"):
            continue
        for sec in d.get("tree", []):
            for w in sec.get("words", []):
                for s in (w.get("synonyms") or []) + (w.get("antonyms") or []):
                    if not s:
                        continue
                    related.add(s.strip())
    return related, known


def load_existing_glossary() -> dict:
    if not GLOSSARY_PATH.exists():
        return {}
    return json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))


def save_glossary(g: dict) -> None:
    GLOSSARY_PATH.write_text(
        json.dumps(g, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_prompt(words: list[str]) -> str:
    joined = "\n".join(f"- {w}" for w in words)
    return f"""아래 영어 단어/구문 목록에 대해 각각의 미국식 IPA 발음 기호와
한국어 뜻(1~2개의 가장 흔한 뜻만, 군더더기 없이)을 JSON으로 만들어라.

목록:
{joined}

출력 형식 — 키는 입력 그대로의 소문자 영단어, 값은 {{"ipa":"/.../","meaning":"한국어 뜻"}}.
{{
  "examine": {{"ipa":"/ɪɡˈzæmɪn/","meaning":"검사하다, 조사하다"}},
  ...
}}

규칙
1. IPA는 반드시 슬래시로 감싼다 — /.../ 형식
2. 한국어 뜻은 짧고 명확하게, 1~2개의 가장 흔한 의미만
3. 구문(여러 단어)은 그대로 키로 사용 — 공백 포함 가능
4. 모르는 단어는 빼지 말고 IPA는 빈 문자열, meaning은 "—"로
5. 코드 펜스 없이 JSON만 출력"""


def call_gemini(client, model: str, words: list[str]) -> dict:
    prompt = build_prompt(words)
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )
    raw = (resp.text or "").strip()
    # 코드펜스 제거 (혹시 모를 대비)
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).rstrip("`").strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1:
        raise ValueError("JSON을 찾지 못함")
    return json.loads(raw[start:end + 1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help="기본 gemini-2.5-flash. 한도 초과 시 gemini-2.5-flash-lite")
    parser.add_argument("--rebuild", action="store_true",
                        help="기존 glossary를 무시하고 처음부터 다시 만듦")
    parser.add_argument("--batch", type=int, default=BATCH_SIZE)
    parser.add_argument("--sleep", type=float, default=1.5)
    parser.add_argument("--limit", type=int, default=0,
                        help="최대 N개 단어만 채움 (테스트용, 0이면 무제한)")
    args = parser.parse_args()

    related, known = collect_targets()
    related_lower = {r.lower() for r in related}
    overlap = len(set(known.keys()) & related_lower)
    print(f"[glossary] 유의어/반의어 단어 — 총 {len(related)}, 자체 사전 중복 {overlap}")

    glossary = {} if args.rebuild else load_existing_glossary()
    need = sorted(
        w for w in related
        if w.lower() not in glossary and w.lower() not in known
    )
    if args.limit:
        need = need[:args.limit]
    print(f"[glossary] 새로 채워야 할 단어 — {len(need)}개")

    if not need:
        print("[glossary] 채울 게 없습니다.")
        save_glossary(glossary)  # 정렬·정형화만 다시
        return 0

    client = genai.Client(api_key=_load_api_key())
    batches = [need[i:i + args.batch] for i in range(0, len(need), args.batch)]
    print(f"[glossary] {len(batches)}회 호출 예정 (배치당 ≤{args.batch}개)")

    added = 0
    for i, batch in enumerate(batches):
        print(f"  · 배치 {i+1}/{len(batches)} — {len(batch)}개 요청…")
        try:
            result = call_gemini(client, args.model, batch)
        except Exception as e:
            print(f"    ✗ 실패 — {e}")
            # 부분이라도 저장하고 다음으로
            save_glossary(glossary)
            continue
        for word, info in result.items():
            key = word.lower()
            ipa = (info or {}).get("ipa", "")
            meaning = (info or {}).get("meaning", "")
            if not ipa and not meaning:
                continue
            glossary[key] = {"ipa": ipa, "meaning": meaning}
            added += 1
        # 부분 저장 — 중간에 끊겨도 진행분 보존
        save_glossary(glossary)
        print(f"    ✓ 저장 (누적 {len(glossary)}개)")
        if i < len(batches) - 1:
            time.sleep(args.sleep)

    print(f"\n[glossary] 완료 — 추가 {added}개, 총 {len(glossary)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
