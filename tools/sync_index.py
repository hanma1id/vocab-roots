# ============================================================
# sync_index.py — 어원 데이터 파일들과 인덱스·캐시를 동기화
# ------------------------------------------------------------
#   - data/roots/*.json 을 스캔해 data/roots.json 인덱스를 다시 만든다
#   - service-worker.js의 CACHE_VERSION을 오늘 날짜로 갱신
#   - 단독 실행도 가능 (python tools/sync_index.py)
# ============================================================

from __future__ import annotations

import datetime
import io
import json
import re
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"
INDEX_PATH = ROOT / "data" / "roots.json"
SW_PATH = ROOT / "service-worker.js"
PREFIXES_PATH = ROOT / "data" / "prefixes.json"
WORDS_PATH = ROOT / "data" / "words.json"
GLOSSARY_PATH = ROOT / "data" / "glossary.json"
RELATED_PATH = ROOT / "data" / "related.json"


def _is_visible(data: dict) -> bool:
    """verified가 명시적으로 True인 어원만 노출."""
    return bool(data.get("verified"))


def rebuild_index() -> list[dict]:
    """data/roots/*.json 들을 읽어 한 줄 요약 인덱스로 정리.
    verified=False인 어원은 건너뛴다 (검수 안 된 자동생성 데이터)."""
    entries = []
    hidden = 0
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        if not _is_visible(data):
            hidden += 1
            continue
        word_count = sum(len(s.get("words", [])) for s in data.get("tree", []))
        entries.append({
            "id": data["id"],
            "origin": data["origin"],
            "rootForm": data["rootForm"],
            "meaning": data["meaning"],
            "cluster": data.get("cluster", ""),
            "step": data.get("step", 0),   # 0 = 미분류
            "wordCount": word_count,
        })

    INDEX_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[sync] 인덱스 — 노출 {len(entries)}개, 숨김 {hidden}개")
    return entries


def rebuild_prefixes(entries: list[dict] = None) -> dict:
    """모든 어원 파일에서 접두어를 모아 data/prefixes.json 으로 정리.

    형태
      {
        "prefixes": [
          { "id": "in",  "form": "in-",  "meaning": "안으로",
            "occurrences": [ {"root":"spec","words":["inspect","inspection"]}, ... ] },
          ...
        ]
      }
    """
    bucket: dict[str, dict] = {}

    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        if not _is_visible(data):
            continue
        for section in data.get("tree", []):
            prefix = (section.get("prefix") or "").strip()
            if not prefix or prefix == "기본형":
                # "기본형"은 접두어가 없는 묶음이라 따로 모으지 않는다
                continue
            # in-, ex- 같은 형태에서 id는 하이픈/공백 제거
            pid = re.sub(r"[^a-zA-Z]", "", prefix).lower()
            if not pid:
                continue
            entry = bucket.setdefault(pid, {
                "id": pid,
                "form": prefix,
                "meaning": section.get("prefixMeaning", ""),
                "occurrences": [],
            })
            # 의미는 더 긴 설명을 채택 (어원마다 짧게 적힐 수 있으니)
            new_meaning = section.get("prefixMeaning", "")
            if len(new_meaning) > len(entry["meaning"]):
                entry["meaning"] = new_meaning
            entry["occurrences"].append({
                "root": data["id"],
                "rootForm": data["rootForm"],
                "rootMeaning": data["meaning"],
                "words": [w["word"] for w in section.get("words", [])],
            })

    # 사용 빈도 높은 접두어가 위로 오도록 정렬
    prefixes = sorted(
        bucket.values(),
        key=lambda p: (-len(p["occurrences"]), p["id"]),
    )
    out = {"prefixes": prefixes}
    PREFIXES_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[sync] 접두어 — {len(prefixes)}개")
    return out


def bump_cache_version() -> str:
    """service-worker.js의 CACHE_VERSION 문자열을 오늘 날짜로 갱신."""
    text = SW_PATH.read_text(encoding="utf-8")
    today = datetime.date.today().isoformat()
    # vocab-roots-vN-YYYY-MM-DD 패턴에서 v 다음 숫자를 +1 (날짜도 갱신)
    def _repl(m):
        n = int(m.group("n")) + 1
        return f'"vocab-roots-v{n}-{today}"'
    new_text, count = re.subn(
        r'"vocab-roots-v(?P<n>\d+)-\d{4}-\d{2}-\d{2}"',
        _repl,
        text,
        count=1,
    )
    if count == 0:
        print("[sync] 경고 — CACHE_VERSION 라인을 찾지 못했습니다")
        return ""
    SW_PATH.write_text(new_text, encoding="utf-8")
    new_version = re.search(r'"(vocab-roots-v\d+-\d{4}-\d{2}-\d{2})"', new_text).group(1)
    print(f"[sync] 캐시 버전 — {new_version}")
    return new_version


def rebuild_words() -> list[dict]:
    """단어 검색 인덱스 — 모든 노출 어원의 단어를 평탄화.

    각 항목 형태
      { "w": "inspect", "m": "안을 들여다보다, 점검하다",
        "p": "/ɪnˈspɛkt/", "root": "spec", "prefix": "in-" }
    """
    items: list[dict] = []
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        data = json.loads(fp.read_text(encoding="utf-8"))
        if not _is_visible(data):
            continue
        for sec in data.get("tree", []):
            for w in sec.get("words", []):
                items.append({
                    "w": w.get("word", ""),
                    "m": w.get("meaning", ""),
                    "p": w.get("ipa", ""),
                    "root": data["id"],
                    "rootForm": data["rootForm"],
                    "prefix": sec.get("prefix", ""),
                })
    # 단어 알파벳 순
    items.sort(key=lambda x: x["w"].lower())
    WORDS_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[sync] 단어 인덱스 — {len(items)}개")
    return items


def rebuild_related() -> dict:
    """유의어/반의어 → 어디서 등장하는지 역방향 매핑.

    형태
      {
        "incredible": [
          {"root":"cred","rootForm":"cred-","word":"credible","role":"antonym","prefix":"기본형"},
          ...
        ],
        ...
      }
    노출(verified=True) 어원만 대상.
    """
    bucket: dict[str, list[dict]] = {}
    for fp in sorted(ROOTS_DIR.glob("*.json")):
        d = json.loads(fp.read_text(encoding="utf-8"))
        if not _is_visible(d):
            continue
        for sec in d.get("tree", []):
            for w in sec.get("words", []):
                for role, key in [("synonym", "synonyms"), ("antonym", "antonyms")]:
                    for s in (w.get(key) or []):
                        if not s:
                            continue
                        bucket.setdefault(s.lower(), []).append({
                            "root": d["id"],
                            "rootForm": d["rootForm"],
                            "word": w["word"],
                            "prefix": sec.get("prefix", ""),
                            "role": role,
                        })
    RELATED_PATH.write_text(
        json.dumps(bucket, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"[sync] 역방향 매핑 — {len(bucket)}개 단어")
    return bucket


def sync_all() -> None:
    entries = rebuild_index()
    rebuild_prefixes(entries)
    rebuild_words()
    rebuild_related()
    bump_cache_version()


if __name__ == "__main__":
    sync_all()
