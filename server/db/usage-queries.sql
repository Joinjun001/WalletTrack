-- 사용 기록 분석용 쿼리 모음. 실행: docker compose exec -T db psql -U wallettrack < db/usage-queries.sql
-- (특정 쿼리만 보려면 복사해서 docker compose exec db psql -U wallettrack 안에서 실행)

-- 일별 방문자 수, 세션 수, 재방문 비율
SELECT date_trunc('day', created_at)::date AS day,
       count(DISTINCT visitor_id) AS visitors,
       count(DISTINCT session_id) AS sessions,
       round(avg((props->>'returning')::boolean::int) * 100) AS returning_pct
FROM usage_events WHERE name = 'page_view'
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;

-- 기기 종류별 방문 (최근 7일)
SELECT props->>'device' AS device, count(*) AS views
FROM usage_events WHERE name = 'page_view' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;

-- 유입 경로 (최근 7일)
SELECT coalesce(props->>'utm_source', props->>'referrer', '(직접)') AS source, count(*) AS views
FROM usage_events WHERE name = 'page_view' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- 세션당 머문 시간 (화면에 보인 시간, 초) 중앙값
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY max_visible) AS median_visible_s
FROM (SELECT session_id, max((props->>'visible_s')::int) AS max_visible
      FROM usage_events WHERE name = 'page_hide' AND created_at > now() - interval '7 days'
      GROUP BY 1) s;

-- 기능별 사용 횟수와 사용한 방문자 수 (최근 7일)
SELECT name, count(*) AS events, count(DISTINCT visitor_id) AS visitors
FROM usage_events WHERE created_at > now() - interval '7 days'
  AND name NOT IN ('page_view', 'page_hide', 'perf')
GROUP BY 1 ORDER BY 3 DESC;

-- 탭별 열람 (최근 7일)
SELECT props->>'tab' AS tab, count(*) AS opens, count(DISTINCT session_id) AS sessions
FROM usage_events WHERE name = 'tab_open' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;

-- 외부 API 연결 실패 (최근 24시간): 출처·상태 코드별 영향받은 세션 수
SELECT props->>'source' AS source, props->>'status' AS status, count(DISTINCT session_id) AS sessions
FROM usage_events WHERE name = 'api_fail' AND created_at > now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- 자주 나는 브라우저 오류 (최근 7일)
SELECT props->>'message' AS message, props->>'file' AS file, count(*) AS times, count(DISTINCT session_id) AS sessions
FROM usage_events WHERE name = 'js_error' AND created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 20;

-- 페이지 로딩 시간 (최근 7일, 기기별 중앙값 ms)
SELECT u.props->>'device' AS device, percentile_cont(0.5) WITHIN GROUP (ORDER BY (p.props->>'load_ms')::int) AS median_load_ms
FROM usage_events p JOIN usage_events u ON u.session_id = p.session_id AND u.name = 'page_view'
WHERE p.name = 'perf' AND p.created_at > now() - interval '7 days'
GROUP BY 1;

-- 최근 의견
SELECT created_at, category, message, context FROM feedback ORDER BY created_at DESC LIMIT 30;
