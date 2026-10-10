/**
 * 용어 설명: data-help가 붙은 제목 옆에 ? 버튼을 달고, 누르면 짧은 설명을 띄운다.
 */

import { track } from './analytics.ts';

const HELP: Record<string, { title: string; body: string }> = {
  kimchi: {
    title: '김치 프리미엄 (김프)',
    body: '한국 거래소 코인 가격이 해외보다 얼마나 비싼지예요. +면 한국이 더 비싸고, −면 더 싸요(역프). 업비트 원화 가격 ÷ (바이낸스 달러 가격 × 업비트 USDT 가격) − 1로 계산해요. 상단 바는 지금 보고 있는 코인 기준이고, 사이드바의 김프 버튼으로 코인별로 비교할 수 있어요.'
  },
  fearGreed: {
    title: '공포·탐욕 지수',
    body: '시장 분위기를 0~100으로 나타낸 지수예요 (alternative.me). 낮을수록 공포(투매), 높을수록 탐욕(과열)이에요.'
  },
  whaleFlow: {
    title: '거래소 흐름',
    body: '알려진 거래소 지갑으로 들어간(입금)·나간(출금) 비트코인이에요. 입금이 많으면 팔려는 물량이, 출금이 많으면 개인 지갑에 보관하려는 물량이 늘었다고 보기도 해요.'
  },
  funding: {
    title: '펀딩비',
    body: '선물 가격을 현물에 맞추려고 롱과 숏이 8시간마다 주고받는 비용이에요. +면 롱이 숏에게 내요 (롱이 많아 과열). −면 숏이 롱에게 내요.'
  },
  oi: {
    title: '미결제약정 (OI)',
    body: '아직 청산되지 않고 열려 있는 선물 포지션의 총량이에요. 늘어나면 새 돈이 들어오며 레버리지가 쌓이고 있다는 뜻이에요.'
  },
  longShort: {
    title: '롱/숏 비율',
    body: '바이낸스에서 상승에 건(롱) 계정과 하락에 건(숏) 계정의 비율이에요. 금액이 아니라 계정 수 기준이에요.'
  },
  fundingTable: {
    title: '코인별 펀딩비',
    body: '코인마다 롱·숏 중 어느 쪽이 더 몰려 있는지 볼 수 있어요. 연환산은 지금 펀딩비가 1년 내내 이어진다고 가정한 값이에요.'
  },
  liqStats: {
    title: '청산 통계',
    body: '증거금이 부족해 거래소가 강제로 정리한 포지션의 합계예요. 롱 청산이 많으면 가격이 급락했고, 숏 청산이 많으면 급등했다는 뜻이에요.'
  },
  liquidations: {
    title: '강제청산',
    body: '레버리지 포지션이 손실을 버티지 못해 거래소가 강제로 정리한 거래예요. 롱 청산은 하락에, 숏 청산은 상승에 터져요. 큰 청산이 연달아 나오면 가격이 더 크게 움직이기도 해요. BTC·ETH·XRP·SOL·DOGE 보기는 바이낸스·바이비트·OKX의 그 코인 청산을 합쳐서, 전체 코인 보기는 바이낸스 선물 전체 코인을 보여 줘요.'
  },
  kimchiHistory: {
    title: '김치 프리미엄 추이',
    body: '김프가 시간에 따라 어떻게 바뀌었는지예요. 김프가 크게 오르면 국내 매수세가 과열됐다는 신호로 보기도 해요.'
  },
  futuresHistory: {
    title: '선물 지표 추이',
    body: '펀딩비·미결제약정·롱 비율이 시간에 따라 어떻게 바뀌었는지예요. 가격과 함께 보면 레버리지가 쌓이는 시기를 알 수 있어요.'
  },
  fee: {
    title: '추천 수수료',
    body: '비트코인을 지갑으로 보낼 때 내는 수수료예요. 많이 낼수록 빨리 처리돼요. 빠름은 다음 블록(약 10분), 30분·1시간은 그 안에 처리될 수준이에요. 단위 sat/vB는 거래 크기 1바이트당 사토시(1억분의 1 BTC)예요. 거래소 안에서 사고파는 데는 상관없어요.'
  },
  block: {
    title: '최근 블록',
    body: '비트코인 거래는 약 10분마다 블록으로 묶여 확정돼요. 가장 최근 블록의 번호(높이), 그 블록을 만든 채굴자, 담긴 거래 수예요.'
  },
  halving: {
    title: '반감기',
    body: '21만 블록(약 4년)마다 채굴 보상이 절반으로 줄어요. 새로 나오는 비트코인이 줄어서 가격에 큰 영향을 주는 이벤트로 꼽혀요.'
  },
  difficulty: {
    title: '난이도 조정',
    body: '2,016블록(약 2주)마다 블록이 평균 10분에 하나씩 나오도록 채굴 난이도가 자동으로 바뀌어요. −면 채굴이 쉬워져요 (채굴자가 줄었다는 뜻일 수 있어요). +면 어려워져요.'
  },
  bigTrades: {
    title: '대형 체결',
    body: '거래소에서 누군가 코인을 한 번에 크게 사거나(매수) 판(매도) 주문이에요. 시장가로 주문한 쪽 기준이에요. 큰 주문은 여러 건으로 쪼개져 체결되므로 같은 거래소·같은 방향 체결을 0.1초 동안 모아 한 건으로 보여 줘요. 바이낸스 선물·현물, 바이비트, OKX, 업비트를 합쳐서 봐요. 코인마다 가격이 달라서 기준은 비트코인 1개 가치 정도로 맞췄어요 (1 BTC, 30 ETH, 6만 XRP, 700 SOL, 100만 DOGE부터).'
  },
  soundAlerts: {
    title: '사운드 알림',
    body: '관심 코인을 최대 5개까지 고르고 강제청산·대형체결 알림을 각각 켜거나 끌 수 있어요. BTC는 기존 5개 마켓 데이터를 그대로 쓰고, 다른 코인은 바이낸스·바이비트 실시간 데이터를 사용해요. 롱 청산·매도는 내려가는 음, 숏 청산·매수는 올라가는 음이고 금액이 클수록 더 크게 여러 번 울려요.'
  },
  surge: {
    title: '급등·급락 포착',
    body: '업비트 원화 코인 중 최근 5분 안의 가장 낮은 가격보다 기준만큼 오르면 급등, 가장 높은 가격보다 그만큼 내리면 급락으로 잡아요. 거래대금이 아주 적은 코인(24시간 5억원 미만)은 빼요. 기록 서버가 24시간 내내 같은 기준으로 모아 두어서 지난 24시간 기록도 볼 수 있어요.'
  },
  chartMarkers: {
    title: '차트 표시 (청산·입출금)',
    body: '캔들마다 바이낸스 선물에서 이 코인이 강제청산된 금액을 합쳐 큰 것만 보여 줘요. 롱청산은 캔들 아래, 숏청산은 위에 찍혀요. 입출금은 비트코인 차트에서 알려진 거래소 지갑으로 들어간(입금)·나간(출금) 큰 온체인 송금이에요. 기록 서버가 모은 기간만 보여요.'
  },
  mempool: {
    title: '대기 중 거래 (멤풀)',
    body: '보냈지만 아직 블록에 들어가지 못하고 기다리는 거래예요. 많을수록 네트워크가 붐비고 수수료가 올라요.'
  }
};

let popover: HTMLDivElement | null = null;
let openButton: HTMLButtonElement | null = null;

function close() {
  if (!popover || !openButton) return;
  popover.hidden = true;
  openButton.setAttribute('aria-expanded', 'false');
  openButton = null;
}

function open(button: HTMLButtonElement, key: string) {
  const help = HELP[key];
  if (!help) return;
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'help-popover glass-panel';
    popover.setAttribute('role', 'dialog');
    document.body.appendChild(popover);
  }
  close();
  popover.innerHTML = '<strong></strong><p></p>';
  popover.querySelector('strong')!.textContent = help.title;
  popover.querySelector('p')!.textContent = help.body;
  popover.setAttribute('aria-label', help.title);
  popover.hidden = false;

  // 버튼 바로 아래, 화면 밖으로 나가지 않게
  const rect = button.getBoundingClientRect();
  const width = popover.offsetWidth;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  popover.style.left = `${left + window.scrollX}px`;
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;

  openButton = button;
  button.setAttribute('aria-expanded', 'true');
  track('help_open', { key });
}

/** 제목의 첫 글자 부분과 ? 버튼을 한 덩어리로 묶는다 (제목이 양 끝 정렬이라 따로 두면 버튼이 가운데로 간다) */
function attachButton(elem: HTMLElement, key: string) {
  const help = HELP[key];
  if (!help) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-btn';
  button.textContent = '?';
  button.setAttribute('aria-label', `${help.title} 설명`);
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openButton === button) close();
    else open(button, key);
  });

  // 제목 앞의 아이콘과 글자를 ? 버튼과 한 묶음으로
  const label = document.createElement('span');
  label.className = 'help-label';
  const first = elem.firstChild;
  if (first instanceof SVGElement && first.classList.contains('icon')) {
    label.append(first);
    first.after(' ');
  }
  const text = elem.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) {
    label.append((text.textContent || '').trim());
    text.remove();
  }
  elem.prepend(label);
  label.append(button);
}

export function initHelp() {
  document.querySelectorAll<HTMLElement>('[data-help]').forEach((elem) => attachButton(elem, elem.dataset.help || ''));

  document.addEventListener('click', (e) => {
    if (popover && !popover.hidden && !popover.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', close);
}
