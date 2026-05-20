# ============================================================
# audit_etymology.py — Gemini로 어원·단어 정합성 자동 검증
# ------------------------------------------------------------
# 각 어원 JSON을 Gemini에 보내, 다음을 점검한다.
#   1) 단어가 정말 그 어원에서 파생됐는가
#   2) 접두어 분류가 맞는가
#   3) 중복 단어
#   4) 너무 학술적/구식이라 학습에 부적합한 단어
#
# 결과는 콘솔 + audit_report.json 파일로.
# 자동 수정은 하지 않는다 — 사용자가 보고 결정.
#
# 사용
#   python tools/audit_etymology.py                # 모든 어원
#   python tools/audit_etymology.py --hidden       # verified=False만
#   python tools/audit_etymology.py --id cred      # 한 어원만
# ============================================================

from __future__ import annotations

import argparse
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
REPORT_PATH = ROOT / "audit_report.json"


def build_prompt(data: dict) -> str:
    """검증 요청 프롬프트."""
    tree_text = []
    for sec in data.get("tree", []):
        words_str = ", ".join(w["word"] for w in sec.get("words", []))
        tree_text.append(f"  [{sec.get('prefix','')}] {sec.get('prefixMeaning','')} — {words_str}")
    tree_dump = "\n".join(tree_text)

    return f"""너는 한국 중·고등학생용 영어 어원 학습 데이터의 정합성을 검증하는 전문가다.

어원 — {data['rootForm']}
의미 — {data['meaning']}
원어 — {data['origin']}

현재 들어가 있는 단어들 (접두어별로 정리)
{tree_dump}

다음을 모두 검증해라.
1. 각 단어가 정말 이 어원에서 파생됐는가 (예 cred에 'decrepit'은 다른 어원이라 잘못됨)
2. 접두어 분류가 맞는가 (예 'incredible'은 in- 부정 접두어)
3. 같은 단어가 두 섹션에 중복 등장하는지
4. 한국 중·고등학생에게 너무 학술적이거나 구식이라 부적합한 단어 (chromoprotein 같은)
5. 접두어 표기 오류 (예 res- 같은 가짜 접두어, 실제는 re-)
6. 단어 자체가 영어 사전에 잘 안 나오는 의심 단어

엄격한 JSON 출력 (코드 펜스 없이)
{{
  "ok": true / false,
  "issues": [
    {{
      "word": "문제 단어",
      "kind": "wrong_etymology / wrong_prefix / duplicate / too_obscure / fake_prefix / not_a_word",
      "detail": "문제 설명 한 줄",
      "suggestion": "교체 또는 수정 제안 (선택)"
    }}
  ],
  "missing_common_words": ["이 어원에서 흔한 단어인데 빠진 것들 0~3개"],
  "summary": "한 줄 요약"
}}

문제 없으면 ok=true, issues=[], missing_common_words=[]"""


def call_audit(client, model: str, data: dict) -> dict:
    prompt = build_prompt(data)
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )
    raw = (resp.text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).rstrip("`").strip()
    s = raw.find("{"); e = raw.rfind("}")
    return json.loads(raw[s:e + 1])


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--id", help="한 어원만 검증")
    p.add_argument("--hidden", action="store_true", help="verified=False 어원만")
    p.add_argument("--all", action="store_true", help="전체 어원 검증")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--sleep", type=float, default=2.0)
    args = p.parse_args()

    files = sorted(ROOTS_DIR.glob("*.json"))
    targets = []
    for fp in files:
        d = json.loads(fp.read_text(encoding="utf-8"))
        if args.id:
            if d["id"] == args.id: targets.append((fp, d))
        elif args.hidden:
            if not d.get("verified"): targets.append((fp, d))
        else:
            targets.append((fp, d))

    if not targets:
        print("검증할 대상이 없습니다.")
        return 0

    print(f"[audit] {len(targets)}개 어원 검증 시작 (model={args.model})")
    client = genai.Client(api_key=_load_api_key())

    report = {"model": args.model, "results": {}}
    if REPORT_PATH.exists():
        try:
            old = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
            report["results"] = old.get("results", {})
        except Exception:
            pass

    for i, (fp, d) in enumerate(targets):
        rid = d["id"]
        print(f"  · {rid:8} 검증 중…", end=" ", flush=True)
        try:
            result = call_audit(client, args.model, d)
        except Exception as e:
            print(f"실패 — {str(e)[:80]}")
            report["results"][rid] = {"error": str(e)[:200]}
            REPORT_PATH.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            if i < len(targets) - 1:
                time.sleep(args.sleep)
            continue
        report["results"][rid] = result
        ok = result.get("ok", False)
        n_issues = len(result.get("issues", []))
        n_missing = len(result.get("missing_common_words", []))
        mark = "✓" if ok and n_missing == 0 else f"⚠ 문제 {n_issues} / 누락 {n_missing}"
        print(mark)
        REPORT_PATH.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if i < len(targets) - 1:
            time.sleep(args.sleep)

    print("\n=== 요약 ===")
    for rid, r in report["results"].items():
        if "error" in r:
            print(f"  · {rid:8} ERR {r['error'][:60]}")
            continue
        n_issues = len(r.get("issues", []))
        n_missing = len(r.get("missing_common_words", []))
        if r.get("ok") and n_missing == 0:
            print(f"  ✓ {rid:8} OK")
        else:
            print(f"  ⚠ {rid:8} 문제 {n_issues}개, 누락 {n_missing}개 — {r.get('summary','')[:60]}")

    print(f"\n전체 리포트 — {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
