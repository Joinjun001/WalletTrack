-- 수집기가 시작할 때마다 실행된다. 이미 있으면 건너뛰므로 여러 번 실행해도 안전하다.

-- 고래 거래 (mempool.space 미확인 거래, MIN_WHALE_BTC 이상)
CREATE TABLE IF NOT EXISTS whale_txs (
  hash             text PRIMARY KEY,
  btc_amount       double precision NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('deposit', 'withdrawal', 'transfer')),
  exchange_address text,                 -- src/txAnalysis.ts KNOWN_EXCHANGES 키 (거래소 이름·아이콘은 웹에서 찾는다)
  detected_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whale_txs_detected_at ON whale_txs (detected_at DESC);

-- 바이낸스 선물 강제청산 (전체 마켓)
CREATE TABLE IF NOT EXISTS liquidations (
  symbol      text NOT NULL,
  position    text NOT NULL CHECK (position IN ('long', 'short')),
  price       double precision NOT NULL,
  quantity    double precision NOT NULL,
  usd_value   double precision NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (symbol, occurred_at, position, quantity) -- 재연결 시 같은 주문이 다시 와도 한 번만 저장
);
CREATE INDEX IF NOT EXISTS liquidations_occurred_at ON liquidations (occurred_at DESC);

-- 선물 지표 (5분마다)
CREATE TABLE IF NOT EXISTS futures_stats (
  symbol        text NOT NULL,
  recorded_at   timestamptz NOT NULL,
  funding_rate  double precision,
  open_interest double precision,          -- 코인 수량
  mark_price    double precision,
  long_ratio    double precision,          -- 롱 계정 비율 (0~1)
  PRIMARY KEY (symbol, recorded_at)
);

-- 코인별 김치 프리미엄 (1분마다)
CREATE TABLE IF NOT EXISTS kimchi_premium (
  symbol      text NOT NULL,
  recorded_at timestamptz NOT NULL,
  krw_price   double precision NOT NULL,
  usd_price   double precision NOT NULL,
  usdt_krw    double precision NOT NULL,
  premium_pct double precision NOT NULL,
  PRIMARY KEY (symbol, recorded_at)
);

-- 웹 사용 기록 (익명). 브라우저마다 만든 무작위 ID만 쓰고 IP 등 개인정보는 저장하지 않는다
CREATE TABLE IF NOT EXISTS usage_events (
  id         bigserial PRIMARY KEY,
  visitor_id text NOT NULL,              -- 브라우저 localStorage의 무작위 ID (재방문 구분용)
  session_id text NOT NULL,              -- 탭을 열 때마다 새로 만드는 무작위 ID
  name       text NOT NULL,              -- page_view, tab_open, alert_add, error ...
  props      jsonb NOT NULL DEFAULT '{}',
  client_at  timestamptz,                -- 브라우저 기준 발생 시각 (모아서 보내므로 created_at과 다를 수 있다)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_created_at ON usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_name ON usage_events (name, created_at DESC);

-- 사이트의 "의견 보내기"로 받은 글 (보관 기간 제한 없음)
CREATE TABLE IF NOT EXISTS feedback (
  id         bigserial PRIMARY KEY,
  visitor_id text NOT NULL,
  category   text NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}', -- 보낸 시점의 탭, 기기 종류, 화면 크기
  created_at timestamptz NOT NULL DEFAULT now()
);
