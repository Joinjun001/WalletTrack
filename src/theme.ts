/**
 * 라이트/다크 모드. 처음 칠할 때 깜빡이지 않도록 data-theme은 index.html의 인라인 스크립트가 먼저 정하고,
 * 여기서는 전환 버튼, 시스템 설정 변경 반영, 차트 색 갱신을 맡는다.
 */

import type { DeepPartial, IChartApi, TimeChartOptions } from 'lightweight-charts';
import { track } from './analytics.ts';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'wallettrack.theme'; // index.html 인라인 스크립트와 같은 키
const charts: IChartApi[] = [];

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** 차트에서 테마에 따라 달라지는 색 (글자, 격자, 축 테두리) */
export function chartThemeOptions(): DeepPartial<TimeChartOptions> {
  const light = currentTheme() === 'light';
  const line = light ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.04)';
  const border = light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.08)';
  return {
    layout: { textColor: light ? '#5B6B80' : '#7A899C' },
    grid: { vertLines: { color: line }, horzLines: { color: line } },
    rightPriceScale: { borderColor: border },
    timeScale: { borderColor: border }
  };
}

/** 테마를 바꿀 때 같이 색을 바꿀 차트 */
export function registerThemedChart(chart: IChartApi) {
  charts.push(chart);
}

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById('theme-toggle');
  if (button) {
    button.textContent = theme === 'light' ? '🌙' : '☀️';
    button.setAttribute('aria-label', theme === 'light' ? '다크 모드로 바꾸기' : '라이트 모드로 바꾸기');
    button.title = button.getAttribute('aria-label') || '';
  }
  const options = chartThemeOptions();
  for (const chart of charts) chart.applyOptions(options);
}

export function initTheme() {
  applyTheme(currentTheme());

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 시크릿 모드 등: 이번 방문 동안만 유지
    }
    track('theme_toggle', { theme: next });
  });

  // 직접 고른 적이 없으면 시스템 설정을 따라간다
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!savedTheme()) applyTheme(e.matches ? 'light' : 'dark');
  });
}
