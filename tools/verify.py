# ============================================================
# verify.py — 전체 데이터셋의 정합성 검사
# ------------------------------------------------------------
# 모든 어원 JSON을 훑어 다음을 확인한다.
#   - 스키마 필수 필드 누락 여부
#   - IPA 형식 (/.../)
#   - 한국어 예문 누락
#   - 인덱스(roots.json)와 실제 파일의 일치
#   - 접두어 인덱스의 일관성
# ============================================================

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
ROOTS_DIR = ROOT / "data" / "roots"
INDEX_PATH = ROOT / "data" / "roots.json"
PREFIXES_PATH = ROOT / "data" / "prefixes.json"

IPA_RE = re.compile(r"^/[^/]+/$")


def check_root_file(path: Path) -> list[str]:
    issues: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"{path.name} — JSON 파싱 실패 ({e})"]

    rid = data.get("id", "?")
    for f in ("id", "origin", "rootForm", "meaning", "story", "tree"):
        if not data.get(f):
            issues.append(f"{rid} — 필수 필드 누락 ({f})")
    if not data.get("cluster"):
        issues.append(f"{rid} — cluster 비어 있음")

    for i, sec in enumerate(data.get("tree", [])):
        prefix = sec.get("prefix", f"<섹션{i}>")
        for w in sec.get("words", []):
            loc = f"{rid}/{prefix}/{w.get('word','?')}"
            for f in ("word", "ipa", "pos", "meaning", "example", "exampleKo"):
                if not w.get(f):
                    issues.append(f"{loc} — {f} 누락")
            if w.get("ipa") and not IPA_RE.match(w["ipa"]):
                issues.append(f"{loc} — ipa 형식 이상 ({w['ipa']})")
    return issues


def main() -> int:
    all_issues: list[str] = []
    files = sorted(ROOTS_DIR.glob("*.json"))
    print(f"[verify] 어원 파일 {len(files)}개 검사")

    file_ids: set[str] = set()
    total_words = 0
    cluster_counts: dict[str, int] = {}
    for fp in files:
        all_issues.extend(check_root_file(fp))
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            file_ids.add(d["id"])
            total_words += sum(len(s.get("words", [])) for s in d.get("tree", []))
            c = d.get("cluster", "")
            cluster_counts[c] = cluster_counts.get(c, 0) + 1
        except Exception:
            pass

    # 인덱스 정합성
    if INDEX_PATH.exists():
        index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        index_ids = {e["id"] for e in index}
        only_in_files = file_ids - index_ids
        only_in_index = index_ids - file_ids
        if only_in_files:
            all_issues.append(f"인덱스에 없는 파일 — {sorted(only_in_files)}")
        if only_in_index:
            all_issues.append(f"파일이 없는 인덱스 — {sorted(only_in_index)}")
    else:
        all_issues.append("data/roots.json 인덱스가 없음")

    if PREFIXES_PATH.exists():
        pref = json.loads(PREFIXES_PATH.read_text(encoding="utf-8"))
        print(f"[verify] 접두어 {len(pref.get('prefixes', []))}개")
    else:
        all_issues.append("data/prefixes.json 접두어 인덱스가 없음")

    print(f"[verify] 어원 {len(files)}개 / 단어 {total_words}개")
    print(f"[verify] 클러스터 분포 —")
    for c, n in sorted(cluster_counts.items(), key=lambda x: -x[1]):
        label = c if c else "(미지정)"
        print(f"   - {label:24} {n}개")

    if all_issues:
        print(f"\n[verify] 문제 {len(all_issues)}개 ↓")
        for i in all_issues[:50]:
            print(f"  - {i}")
        if len(all_issues) > 50:
            print(f"  … 외 {len(all_issues) - 50}개 더")
        return 1
    print("\n[verify] 모두 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
