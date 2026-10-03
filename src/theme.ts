/**
 * 라이트/다크 모드와 상승·하락 색(국내식 빨강↑ 파랑↓ / 해외식 초록↑ 빨강↓).
 * 처음 칠할 때 깜빡이지 않도록 data-theme·data-colors는 index.html의 인라인 스크립트가 먼저 정하고,
 * 여기서는 전환 버튼, 시스템 설정 변경 반영, 차트 색 갱신을 맡는다.
 */

import type { DeepPartial, IChartApi, TimeChartOptions } from 'lightweight-charts';
import { track } from './analytics.ts';

export type Theme = 'dark' | 'light';
export type ColorScheme = 'kr' | 'global';

const THEME_KEY = 'wallettrack.theme';   // index.html 인라인 스크립트와 같은 키
const COLORS_KEY = 'wallettrack.colors'; // 〃
const charts: IChartApi[] = [];
const colorListeners: (() => void)[] = [];

export function currentColorScheme(): ColorScheme {
  return document.documentElement.dataset.colors === 'global' ? 'global' : 'kr';
}

/** 지금 테마·색 설정의 상승/하락 색 (style.css의 --up, --down) */
export function marketColors(): { up: string; down: string; upAlpha: (a: number) => string; downAlpha: (a: number) => string } {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    up: get('--up'),
    down: get('--down'),
    upAlpha: (a) => `rgba(${get('--up-rgb')}, ${a})`,
    downAlpha: (a) => `rgba(${get('--down-rgb')}, ${a})`
  };
}

/** 상승/하락 색이 바뀌면 (테마 전환 포함) 호출. 차트가 캔들·영역 색을 다시 칠한다 */
export function onMarketColorsChange(fn: () => void) {
  colorListeners.push(fn);
}

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
  for (const fn of colorListeners) fn(); // 라이트·다크에 따라 상승/하락 색 밝기도 다르다
}

function applyColorScheme(scheme: ColorScheme) {
  document.documentElement.dataset.colors = scheme;
  const button = document.getElementById('color-toggle');
  if (button) {
    const label = scheme === 'kr' ? '상승 빨강·하락 파랑 (국내식). 누르면 해외식으로' : '상승 초록·하락 빨강 (해외식). 누르면 국내식으로';
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  for (const fn of colorListeners) fn();
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 시크릿 모드 등: 이번 방문 동안만 유지
  }
}

export function initTheme() {
  applyTheme(currentTheme());

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    save(THEME_KEY, next);
    track('theme_toggle', { theme: next });
  });

  applyColorScheme(currentColorScheme());
  document.getElementById('color-toggle')?.addEventListener('click', () => {
    const next: ColorScheme = currentColorScheme() === 'kr' ? 'global' : 'kr';
    applyColorScheme(next);
    save(COLORS_KEY, next);
    track('color_scheme_toggle', { scheme: next });
  });

  // 직접 고른 적이 없으면 시스템 설정을 따라간다
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!savedTheme()) applyTheme(e.matches ? 'light' : 'dark');
  });
}
