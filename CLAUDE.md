# WalletTrack 작업 규칙

한국 사용자용 비트코인·코인 실시간 대시보드. **데스크톱 브라우저(1440×900) 기준**으로 만들고, 모바일은 깨지지 않게만 유지한다.
코드 주석, 커밋 메시지, 화면 문구는 한국어.

## 구조

| 부분 | 위치 | 배포 |
|---|---|---|
| 웹 (Vite + TS, 프레임워크 없음) | `index.html`, `src/` | `main`에 푸시하면 Vercel이 자동 배포 (https://wallet-track-theta.vercel.app) |
| 수집기·기록 API·업비트 중계 | `server/` | 이 서버(OCI)에서 `cd server && docker compose up -d --build api` (수집기를 바꿨으면 `collector`도) |

- 서버는 웹의 `src/txAnalysis.ts`, `src/market.ts`, `src/coins.ts`, `src/surge.ts`를 같이 쓴다. 서버가 다른 `src/` 파일을 쓰게 되면 `server/Dockerfile`의 `COPY`에도 추가한다.
- **업비트 REST(시세·캔들·마켓 목록)는 브라우저에서 직접 부르지 않는다.** 업비트가 출처(Origin)별로 막아서 429가 난다. `historyApi.ts`의 `getUpbit()`로 서버 중계(`/api/upbit/...`)를 거친다. 업비트 WebSocket은 직접 써도 된다.
- 기록 추이·청산 통계·거래소 흐름은 **서버 DB에 쌓인 만큼만** 보인다. 기간이 짧게 보이면 `server/src/backfill.ts`로 거래소 과거 데이터를 채울 수 있는지 본다.

## 고칠 때: 같은 원인이 있는 곳을 모두 확인한다

버그를 하나 고치면 **같은 원인이 있을 만한 곳을 전부 찾아보고, 확인한 목록과 결과를 보고에 적는다.** 한 곳만 고치고 끝내지 않는다.

자주 겹치는 묶음:
- **차트**: `priceChart.ts`(가격), `historyCharts.ts`(김프·선물 추이). 데이터 범위·갱신·테마 색 문제는 셋 다 확인한다.
- **외부 API 호출**: `grep -rn "fetch(\|new WebSocket" src server/src`로 전부 확인 (지역 제한 451, 요청 제한 429, 재연결).
- **실시간 목록**: 고래 피드, 강제청산 피드, 코인 사이드바.
- **CSS 반응형**: 같은 선택자를 덮어쓰는 `@media` 규칙이 파일 뒤쪽에 있으면 앞의 좁은 화면 규칙을 이긴다. 레이아웃을 바꾸면 1440 / 1200 / 960 / 390px을 모두 확인한다.

## 화면을 바꿀 때 체크리스트

1. `npm run typecheck && npm test && npm run build`
2. 1440×900 다크·라이트에서 확인하고, 390px 모바일이 깨지지 않았는지 본다 (Playwright 캡처를 직접 열어 본다).
3. `npm run screenshots`로 `image/` 스크린샷을 다시 찍는다.
4. `README.md`의 기능 설명과 프로젝트 구조를 현재 화면에 맞게 고친다. 서버 API를 바꿨으면 `server/README.md`의 API 표도.
5. 초보자가 모를 용어가 새로 나오면 `src/help.ts`에 설명을 넣고 제목에 `data-help`를 붙인다.
6. 화면에 이모지를 쓰지 않는다. 아이콘은 `index.html`의 SVG 묶음(`#i-이름`)에 같은 선 굵기로 추가하고 `src/icons.ts`의 `icon()`으로 쓴다. 강조색은 `--accent`(인디고) 하나만 쓴다.

## 개발 전에 계획부터 확인받는다

- **코드를 바꾸는 요청을 받으면 바로 개발하지 않는다.** 먼저 어떻게 만들지 정리해서 보여 주고, 사용자가 진행하라고 하면 그때 시작한다 (사용자 요청, 2026-10-04). 작은 수정도 마찬가지다.
- 계획에 적을 것: 무엇을 바꾸는지(화면·동작), 고칠 파일, 방법, 서버·DB 변경 여부, 기존 사용자에게 달라지는 점, 애매해서 사용자가 정해야 할 것.
- 질문에 답하거나 조사·비교만 하는 요청은 계획 없이 바로 답한다.
- 계획을 승인받은 뒤에는 아래 커밋·배포 규칙대로 끝까지 진행한다.

## 보안 체크리스트 (기능을 추가·수정할 때 확인)

- **화면에 넣는 외부 문자열**(거래소·서버·사용자 입력)은 `innerHTML`에 넣기 전에 `escapeHtml`. 숫자는 포맷 함수를 거친다.
- **새 외부 주소**(fetch·WebSocket)를 쓰면 `vercel.json` CSP `connect-src`에 추가한다. 빠뜨리면 배포 사이트에서만 막힌다 (`npm test`의 securityHeaders 테스트가 잡는다).
- **`index.html` 인라인 스크립트를 고치면** `vercel.json` CSP의 `sha256-...` 해시도 바꾼다 (테스트가 새 해시를 알려 준다).
- **새 서버 API**: 쿼리는 매개변수(`$1`)로만, 숫자 값은 `numParam`으로 상한을 둔다. 한 요청이 너무 많은 행을 계산하지 않게 한다 (구간 합계는 `bucketParams`, 점 5,000개까지).
- 조회 API는 IP별 1분 300회, 업비트 중계는 1분 120회로 제한돼 있다. 업비트 중계에 새 경로를 추가하면 허용 값만 받는다 (임의 주소를 대신 부르지 않게).
- POST는 `config.postOrigins`(우리 사이트) 출처만 받는다. 새 POST를 만들면 본문 크기·형식 검사와 횟수 제한을 둔다.
- 비밀값은 `server/.env`에만 둔다 (git 제외). 예시는 `server/.env.example`.
- DB·API 포트는 외부에 열지 않는다 (DB 포트 없음, API는 `127.0.0.1:8080` → nginx).
- 의존성을 추가하면 `npm audit` (웹·`server/` 둘 다).

## 커밋·배포

- **작업이 끝나면 확인 질문 없이 커밋하고 `main`에 푸시해 배포까지 마친다** (사용자 요청, 2026-10-04). 서버 코드를 바꿨으면 `docker compose up -d --build`로 서버도 반영한다.

- 이 서버에는 git 작성자가 설정돼 있지 않다: `git -c user.name=joinjun001 -c user.email=109087027+Joinjun001@users.noreply.github.com commit ...`
- 작업 브랜치 `feat/market-tools`와 `main`이 같은 커밋을 가리키게 둘 다 푸시한다 (`git push origin HEAD:main && git push origin HEAD`).
- 푸시 후 실제 사이트에 반영됐는지 확인한다.
