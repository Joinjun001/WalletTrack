/**
 * 환경 변수 설정 (server/.env.example 참고)
 */

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback;
}

export const config = {
  // 비어 있으면 DB 없이 저장할 내용을 로그로만 출력한다 (로컬 시험용)
  databaseUrl: process.env.DATABASE_URL || '',
  apiPort: num('API_PORT', 8080),
  // 공개 시세 데이터만 읽기 전용으로 제공하므로 기본은 모든 출처 허용
  corsOrigin: process.env.CORS_ORIGIN || '*',
  retentionDays: num('RETENTION_DAYS', 180),
  minWhaleBtc: num('MIN_WHALE_BTC', 0.1),
  futuresSymbols: list('FUTURES_SYMBOLS', ['BTCUSDT', 'ETHUSDT']),
  futuresIntervalMs: num('FUTURES_INTERVAL_SEC', 300) * 1000,
  kimchiIntervalMs: num('KIMCHI_INTERVAL_SEC', 60) * 1000
};

export function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
}
