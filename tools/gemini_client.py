# ============================================================
# gemini_client.py — 어원 JSON을 만들어 주는 Gemini 래퍼
# ------------------------------------------------------------
# 책임 분리
#   - API 키 로드 (환경변수 → 자비스 .env → 로컬 .env 순)
#   - 어원 한 개를 위한 프롬프트 구성
#   - JSON 응답을 받아 파싱·검증
#   - 검증 실패 시 한 번 재시도
# ============================================================

from __future__ import annotations

import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-2.5-flash"

# .env 검색 경로 — 위에서부터 차례로 시도
ENV_PATHS = [
    Path(__file__).parent.parent / ".env",   # vocab-roots/.env
    Path("C:/jarvis/.env"),                  # 자비스 키 공용
]


def _load_api_key() -> str:
    """환경변수 우선, 없으면 .env 파일에서 GEMINI_API_KEY 찾기."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()

    for path in ENV_PATHS:
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                # KEY=VALUE 형식만 처리 (앞 공백·따옴표 제거)
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("GEMINI_API_KEY"):
                    _, _, value = line.partition("=")
                    return value.strip().strip("'\"")
        except Exception as e:
            print(f"[gemini] .env 읽기 실패 — {path} ({e})")

    raise RuntimeError(
        "GEMINI_API_KEY를 찾지 못했습니다. "
        "환경변수로 지정하거나 vocab-roots/.env 또는 C:/jarvis/.env에 추가하세요."
    )


# ----------- 프롬프트 빌더 -----------

ROOT_SCHEMA_HINT = """JSON 스키마는 다음과 같다.

{
  "id": "spec",                          // 짧은 영문 식별자, 파일명에도 그대로 사용
  "origin": "Latin",                     // Latin 또는 Greek
  "rootForm": "spec-, spect-, spic-",    // 모든 표면형
  "meaning": "보다, 살펴보다",            // 한국어 의미 (1~2개)
  "cluster": "시각",                     // 의미 클러스터 (입력 파라미터로 받음)
  "story": "라틴어 동사 specere…",       // 2~3문장의 한국어 어원 이야기
  "tree": [
    {
      "prefix": "in-",                   // 접두어. 기본형은 "기본형"이라고 쓴다.
      "prefixMeaning": "안으로",         // 접두어 한국어 의미. 기본형이면 "접두어 없이"
      "words": [
        {
          "word": "inspect",
          "ipa": "/ɪnˈspɛkt/",
          "pos": "v",                    // v, n, adj, adv, v·n 등
          "meaning": "안을 들여다보다, 점검하다",
          "example": "The officer inspected the passport carefully.",
          "exampleKo": "그 경찰관은 여권을 꼼꼼히 검사했다.",
          "synonyms": ["examine", "check"],
          "antonyms": ["overlook"]
        }
      ]
    }
  ]
}
"""


def build_prompt(
    root_id: str,
    root_form: str,
    meaning: str,
    origin: str,
    cluster: str,
    target_words: int,
    exclude_words: Optional[list[str]] = None,
    extra_note: str = "",
) -> str:
    """어원 한 개 생성용 프롬프트."""
    exclude_text = ""
    if exclude_words:
        joined = ", ".join(sorted(set(exclude_words)))
        exclude_text = (
            f"\n다음 단어들은 이미 추가되어 있으니 절대 다시 포함하지 마라 — {joined}\n"
        )

    return f"""너는 한국 중·고등학생을 위한 영어 어원 학습 데이터 작성자다.
아래 어원에 대해 학습용 JSON을 만들어라.

- 어원 id — {root_id}
- 어원 표면형 — {root_form}
- 한국어 의미 — {meaning}
- 원어 — {origin}
- 의미 클러스터 — {cluster}
- 목표 단어 수 — 정확히 {target_words}개 (접두어별로 나뉘어도 합계가 {target_words})

작성 규칙
1. 단어는 한국 중·고등학생이 실제 쓸 만한 빈출 어휘 위주로 선정
2. 접두어별로 묶어 tree 배열을 만든다. 접두어가 없는 단어는 "기본형" 섹션에 둔다
3. 같은 접두어 안의 단어는 의미가 가까운 것끼리 인접 배치
4. 한국어 의미는 1~2개의 가장 흔한 뜻만, 군더더기 없이
5. 예문은 짧고 명확하게, 중학생도 읽을 수 있는 수준
6. IPA는 미국식 발음 기호로
7. synonyms와 antonyms는 영어로, 각 0~3개 (없으면 빈 배열)
8. 의미적 비약(예 라틴어 어원에서 너무 멀어진 단어)은 피한다
{exclude_text}
{extra_note}

{ROOT_SCHEMA_HINT}

출력은 위 스키마를 따르는 JSON 한 덩어리만. 코드 펜스도, 설명도 붙이지 마라."""


# ----------- 검증 -----------

IPA_RE = re.compile(r"^/[^/]+/$")
ALLOWED_POS = {
    "v", "n", "adj", "adv", "prep", "conj", "pron",
    "v·n", "n·v", "v, n", "n, v", "v·adj", "adj·n", "n·adj",
    "v, adj", "adj, n", "n, adj"
}


def validate_root(data: dict, expected_id: str, min_words: int) -> list[str]:
    """돌려준 JSON이 스키마에 맞는지 검사. 문제 목록을 반환 (비면 통과)."""
    issues: list[str] = []
    for field in ("id", "origin", "rootForm", "meaning", "story", "tree"):
        if field not in data:
            issues.append(f"필수 필드 누락 — {field}")

    if data.get("id") != expected_id:
        issues.append(f"id 불일치 — 기대 {expected_id}, 받은 {data.get('id')}")

    if data.get("origin") not in {"Latin", "Greek"}:
        issues.append(f"origin이 Latin/Greek 아님 — {data.get('origin')}")

    tree = data.get("tree", [])
    if not isinstance(tree, list) or not tree:
        issues.append("tree가 비었거나 배열이 아님")
        return issues

    total_words = 0
    for i, section in enumerate(tree):
        if "prefix" not in section or "words" not in section:
            issues.append(f"tree[{i}] — prefix/words 누락")
            continue
        for j, w in enumerate(section.get("words", [])):
            total_words += 1
            loc = f"tree[{i}].words[{j}]({w.get('word')})"
            for f in ("word", "ipa", "pos", "meaning", "example", "exampleKo"):
                if not w.get(f):
                    issues.append(f"{loc} — {f} 누락")
            if w.get("ipa") and not IPA_RE.match(w["ipa"]):
                issues.append(f"{loc} — ipa 형식 이상 ({w['ipa']})")
            if w.get("pos") and w["pos"] not in ALLOWED_POS:
                # 너무 빡빡하지 않게 — 경고만, 자동 통과
                pass
            if "synonyms" in w and not isinstance(w["synonyms"], list):
                issues.append(f"{loc} — synonyms가 배열 아님")
            if "antonyms" in w and not isinstance(w["antonyms"], list):
                issues.append(f"{loc} — antonyms가 배열 아님")

    if total_words < min_words:
        issues.append(f"총 단어 수 부족 — 받은 {total_words}, 최소 {min_words}")

    return issues


# ----------- 실제 호출 -----------

def _extract_json(raw: str) -> dict:
    """모델이 가끔 코드펜스를 붙이거나 앞뒤에 글을 넣어도 JSON만 뽑아낸다."""
    raw = raw.strip()
    # ```json …``` 형태 제거
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).rstrip("`").strip()
    # 가장 바깥 중괄호 짝만 뽑기
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("JSON 객체를 찾을 수 없음")
    return json.loads(raw[start : end + 1])


def generate_root(
    root_id: str,
    root_form: str,
    meaning: str,
    origin: str,
    cluster: str,
    target_words: int = 12,
    exclude_words: Optional[list[str]] = None,
    extra_note: str = "",
    max_retries: int = 1,
    model: str = DEFAULT_MODEL,
) -> dict:
    """Gemini로 어원 JSON 생성. 검증 실패 시 한 번 더 시도.

    model — 무료 한도 초과 시 'gemini-2.5-flash-lite'로 바꿔 호출하면 별도 한도 사용 가능.
    """
    client = genai.Client(api_key=_load_api_key())
    last_issues: list[str] = []

    for attempt in range(max_retries + 1):
        prompt = build_prompt(
            root_id, root_form, meaning, origin, cluster,
            target_words, exclude_words, extra_note
        )
        if attempt > 0 and last_issues:
            # 재시도 시 직전 문제를 알려준다
            prompt += (
                "\n\n직전 시도에서 다음 문제가 있었다. 반드시 고쳐서 다시 만들어라.\n- "
                + "\n- ".join(last_issues)
            )

        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.6,
            ),
        )
        raw = response.text or ""

        try:
            data = _extract_json(raw)
        except Exception as e:
            last_issues = [f"JSON 파싱 실패 — {e}"]
            print(f"[gemini] 시도 {attempt + 1} — 파싱 실패")
            continue

        # cluster 필드는 모델이 빠뜨릴 수 있으니 우리가 채워 넣는다
        data.setdefault("cluster", cluster)

        issues = validate_root(data, root_id, max(1, target_words - 2))
        if not issues:
            return data
        last_issues = issues
        print(f"[gemini] 시도 {attempt + 1} — 검증 실패")
        for i in issues[:8]:
            print(f"   - {i}")

    # 마지막 시도도 실패하면 — 받은 데이터를 그대로 돌려주되 호출자가 처리하게
    raise RuntimeError(
        "Gemini 생성 실패. 문제 — " + "; ".join(last_issues[:5])
    )


def expand_words(
    existing: dict,
    target_total: int,
    cluster: str = "",
    model: str = DEFAULT_MODEL,
) -> dict:
    """이미 있는 어원 데이터에 단어를 추가해 총 target_total개로 늘림.

    동작
      1) 기존 단어 목록은 그대로 보존
      2) Gemini에는 부족한 분량(need)만큼만 새 단어를 요청 (중복 금지)
      3) 받은 새 트리를 기존 트리에 머지 — 같은 접두어는 합치고 새 접두어는 추가
      4) cluster·story 등 메타는 기존 값 우선
    """
    have_words = []
    for section in existing.get("tree", []):
        for w in section.get("words", []):
            have_words.append(w["word"])
    need = target_total - len(have_words)
    if need <= 0:
        return existing

    extra_note = (
        f"\n중요 — 정확히 {need}개의 NEW 단어만 만들어라. "
        f"기존 단어({', '.join(have_words[:15])}…)와 중복 금지. "
        f"접두어별로 묶어 tree에 넣되, 총합이 {need}개가 되도록 한다."
    )

    new_data = generate_root(
        root_id=existing["id"],
        root_form=existing["rootForm"],
        meaning=existing["meaning"],
        origin=existing["origin"],
        cluster=cluster or existing.get("cluster", ""),
        target_words=need,
        exclude_words=have_words,
        extra_note=extra_note,
        model=model,
    )

    # ----- 머지 -----
    merged = json.loads(json.dumps(existing))  # deep copy
    # 접두어 → 인덱스 매핑 만들어 두기
    prefix_to_idx: dict[str, int] = {}
    for i, sec in enumerate(merged["tree"]):
        prefix_to_idx[sec.get("prefix", "")] = i

    existing_words_lower = {w.lower() for w in have_words}
    added = 0
    for new_sec in new_data.get("tree", []):
        prefix = new_sec.get("prefix", "")
        new_words = [
            w for w in new_sec.get("words", [])
            if w.get("word", "").lower() not in existing_words_lower
        ]
        if not new_words:
            continue
        if prefix in prefix_to_idx:
            merged["tree"][prefix_to_idx[prefix]]["words"].extend(new_words)
        else:
            merged["tree"].append({
                "prefix": prefix,
                "prefixMeaning": new_sec.get("prefixMeaning", ""),
                "words": new_words,
            })
            prefix_to_idx[prefix] = len(merged["tree"]) - 1
        added += len(new_words)
        for w in new_words:
            existing_words_lower.add(w["word"].lower())

    # cluster는 기존 값 또는 인자값 유지
    if cluster:
        merged["cluster"] = cluster
    elif "cluster" not in merged:
        merged["cluster"] = new_data.get("cluster", "")
    print(f"   ↳ {added}개 단어 추가, 총 {sum(len(s['words']) for s in merged['tree'])}개")
    return merged
