/**
 * PostgreSQL 연결. DATABASE_URL이 없으면 dry-run: 쿼리를 실행하지 않고 로그로만 남긴다.
 */

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config, log } from './config.ts';

// bigint(count 등)는 기본적으로 문자열로 오므로 숫자로 받는다 (이 서비스의 값은 2^53을 넘지 않는다)
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => parseInt(v, 10));

const pool = config.databaseUrl ? new pg.Pool({ connectionString: config.databaseUrl, max: 5 }) : null;

pool?.on('error', (e) => log('PostgreSQL pool error:', e.message));

export const dryRun = !pool;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) {
    log('[dry-run]', text.trim().split('\n')[0], JSON.stringify(params));
    return [];
  }
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function migrate() {
  if (!pool) return;
  const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  log('DB 스키마 확인 완료');
}

/** 한 번 실행하고 끝나는 스크립트(backfill.ts)용 */
export async function closeDb() {
  await pool?.end();
}
