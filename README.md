# 어원으로 배우는 영어단어 (PWA)

윤하가 태블릿에서 보는, 어원 중심의 영어단어 학습 웹앱입니다.
한 페이지 = 한 어원, 거기서 파생된 단어들이 접두어별 트리로 펼쳐집니다.
오프라인에서도 동작하고, 홈 화면에 앱 아이콘으로 추가할 수 있습니다.

## 폴더 구조

```
vocab-roots/
├─ index.html            홈 (어원/접두어 두 모드)
├─ root.html             어원 상세 페이지
├─ prefix.html           접두어 상세 (예 prefix.html?id=in)
├─ map.html              의미 클러스터 지도
├─ manifest.json         PWA 매니페스트
├─ service-worker.js     오프라인 캐시
├─ css/style.css
├─ js/
│  ├─ app.js             홈 동작 (어원/접두어 모드 전환)
│  ├─ root-page.js       어원 상세 동작
│  ├─ prefix-page.js     접두어 상세 동작
│  ├─ map-page.js        의미 지도 동작
│  ├─ data-loader.js     데이터 로드 + 진도 관리
│  └─ tts.js             영어 발음 (Web Speech API)
├─ data/
│  ├─ roots.json         어원 인덱스
│  ├─ prefixes.json      접두어 인덱스 (자동 생성)
│  └─ roots/             어원당 상세 JSON
├─ tools/                ← Gemini 자동 추가 도구 (Python)
│  ├─ gemini_client.py   Gemini API 래퍼 + 스키마 검증
│  ├─ add_root.py        새 어원 한 개 생성
│  ├─ expand_root.py     기존 어원 단어 수 확장
│  ├─ seed_new_roots.py  미리 정의된 어원 묶음 일괄 생성
│  ├─ apply_clusters.py  의미 클러스터 일괄 적용
│  └─ sync_index.py      인덱스·접두어·캐시 동기화
└─ icons/
```

## 로컬 실행

서비스 워커가 `file://`에서는 동작하지 않으니, 간단한 정적 서버를 띄워야 합니다.

```powershell
cd "C:\Users\hideo\내 드라이브\codex\vocab-roots"
python -m http.server 8000
```

브라우저에서 <http://localhost:8000> 접속.

## 태블릿에서 보는 법

1. PC와 태블릿이 같은 와이파이에 있어야 합니다.
2. PC의 IP 주소 확인 — PowerShell에서 `ipconfig` 후 IPv4 주소를 확인 (예 `192.168.1.10`).
3. 태블릿 브라우저에서 `http://192.168.1.10:8000` 접속.
4. **아이패드 Safari** — 공유 아이콘 → "홈 화면에 추가"
   **안드로이드 Chrome** — 메뉴 → "앱 설치" 또는 "홈 화면에 추가"
5. 홈 화면 아이콘으로 실행하면 주소창이 사라지고 앱처럼 동작합니다.
6. 첫 실행 후엔 PC가 꺼져 있어도 오프라인으로 동작합니다 (서비스 워커 캐시 덕분).

## 어원 추가하는 법 — Gemini 자동 도구

먼저 SDK 설치 (한 번만)
```powershell
pip install google-genai
```

API 키는 `$env:GEMINI_API_KEY` 또는 `C:/jarvis/.env` 또는 `vocab-roots/.env`에서 자동으로 읽습니다.

### 새 어원 한 개 추가
```powershell
python tools/add_root.py --id spir --form "spir-, spire-" \
    --meaning "숨쉬다" --origin Latin --cluster "생명·호흡·정신" --words 12
```
인자 없이 실행하면 대화형으로 물어봅니다. 끝나면 `data/roots.json` 인덱스, `data/prefixes.json` 접두어 목록, `service-worker.js`의 캐시 버전이 자동 동기화됩니다.

### 기존 어원에 단어 추가
```powershell
# 어원 하나만
python tools/expand_root.py --id spec --target 15

# 모든 어원을 15단어로 일괄
python tools/expand_root.py --all --target 15
```
기존 단어는 그대로 보존하고, 부족한 만큼만 새로 생성해 머지합니다.

### 클러스터 일괄 적용
어원의 의미 그룹(보다·말하다 등)은 `tools/apply_clusters.py`의 `CLUSTER_MAP`에 정의돼 있습니다. 매핑을 바꾼 뒤
```powershell
python tools/apply_clusters.py
```

### 인덱스·캐시만 다시 만들기
JSON을 손으로 수정한 뒤에는
```powershell
python tools/sync_index.py
```
만 돌리면 인덱스·접두어·캐시 버전이 갱신됩니다.

## 기술 메모

- **순수 정적 PWA** — 빌드 도구 없음, 의존성 없음, 어떤 정적 서버든 호스팅 가능
- **ES Modules** — `<script type="module">` 사용. 이 때문에 file://에서는 CORS로 막힌다
- **localStorage 진도 저장** — 같은 기기·브라우저에서만 유지됨
- **Web Speech API** — 외부 발음 파일 없이 OS 내장 음성으로 재생
- **다크 모드** — `prefers-color-scheme`로 자동 전환 (별도 토글 없음)

## 라이선스

개인 학습용. 데이터는 일반적인 언어 사실이라 출처 표시 없이 사용해도 무방.
