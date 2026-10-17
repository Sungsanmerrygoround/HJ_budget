// 임시 검증 스크립트: node test-capmerge.mjs
import { mergeCaptures } from "./src/capmerge.js";

// 오늘 날짜에 따라 결과가 바뀌지 않게 '오늘'을 고정 (날짜 헤더는 이 기준으로 연도를 정함)
const NOW = new Date(2026, 9, 17); // 2026-10-17
const merge = (texts) => mergeCaptures(texts, { now: NOW });

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else {
    fail++;
    console.log(`❌ ${name}\n   기대: ${JSON.stringify(expected)}\n   실제: ${JSON.stringify(got)}`);
  }
}
const summary = (r) => r.expenses.map((e) => `${e.merchant}|${e.amount}|${e.date.slice(5)}`);

// 스크롤하며 찍은 두 장: B는 6월 6일 헤더가 위로 잘렸고, 맨 위 맥도날드는 A 아래와 겹침
const A = `
6월 7일 일요일
스타벅스 -5,500원
16:38 1,234,500원
6월 6일 토요일
GS25 -2,300원
17:02 1,240,000원
맥도날드 -7,900원
12:10 1,242,300원
`;
const B = `
맥도날드 -7,900원
12:10 1,242,300원
올리브영 -12,500원
11:00 1,250,200원
6월 5일 금요일
배달의민족 -23,000원
19:30 1,262,700원
`;
const AB = ["스타벅스|5500|06-07", "GS25|2300|06-06", "맥도날드|7900|06-06", "올리브영|12500|06-06", "배달의민족|23000|06-05"];

// 1) 겹친 거래는 한 번만, 헤더가 잘린 윗부분(올리브영)은 앞 장의 날짜(6/6)를 이어받음
{
  const r = merge([A, B]);
  check("스크롤 2장 합치기", summary(r), AB);
  check("겹친 건수", r.overlapped, 1);
  check("장 번호(src)·장 안 순번(idx)", r.expenses.map((e) => `${e.src}:${e.idx}`), ["0:0", "0:1", "0:2", "1:1", "1:2"]);
}

// 2) 거꾸로 골라도 화면 순서(최신→과거)로 정렬돼 같은 결과
{
  const r = merge([B, A]);
  check("거꾸로 고른 순서", summary(r), AB);
  check("거꾸로 고른 순서의 src", r.expenses.map((e) => e.src), [1, 1, 1, 0, 0]);
}

// 3) 같은 분에 같은 금액 두 건(커피 두 잔)은, 한 건만 겹쳐 찍혔으면 둘 다 남음
{
  const r = merge([`
6월 7일 일요일
메가커피 -2,000원
09:00 100,000원
메가커피 -2,000원
09:00 102,000원
`, `
메가커피 -2,000원
09:00 102,000원
김밥천국 -4,000원
08:30 104,000원
`]);
  check("커피 두 잔 보존", summary(r), ["메가커피|2000|06-07", "메가커피|2000|06-07", "김밥천국|4000|06-07"]);
  check("커피 두 잔 겹친 건수", r.overlapped, 1);
}

// 4) 같은 날·같은 금액이라도 시간이 다르면 다른 거래
{
  const r = merge([`
6월 7일 일요일
스타벅스 -5,500원
16:38 1,234,500원
`, `
6월 7일 일요일
스타벅스 -5,500원
10:00 1,240,000원
`]);
  check("시간 다른 같은 금액 보존", r.expenses.length, 2);
}

// 5) 시간을 못 읽은 쪽이 있으면 가맹점명까지 같아야 겹침으로 봄
{
  const r = merge([`
6월 7일 일요일
스타벅스 -5,500원
16:38 1,234,500원
`, `
6월 7일 일요일
스타벅스 -5,500원
이디야 -5,500원
`]);
  check("시간 없을 땐 가맹점명으로 비교", summary(r), ["스타벅스|5500|06-07", "이디야|5500|06-07"]);
}

// 6) 같은 캡쳐를 두 번 올려도 한 번만 (수입도 한 번만 셈)
{
  const withIncome = A.replace("6월 6일 토요일", "6월 6일 토요일\n이자입금 +1,200원\n09:00 1,238,800원");
  const r = merge([withIncome, withIncome]);
  check("같은 캡쳐 두 번", summary(r), AB.slice(0, 3));
  check("같은 캡쳐 두 번 겹친 건수", r.overlapped, 3);
  check("겹친 수입은 한 번만", r.excludedIncome, 1);
}

// 7) 읽지 못한 장(null)은 건너뛰고, src는 원래 위치를 가리킴
{
  const r = merge([null, A]);
  check("읽지 못한 장 건너뜀", r.expenses.map((e) => e.src), [1, 1, 1]);
}

// 8) 한 장만이면 기존 단일 캡쳐와 같은 결과 / 0장이면 빈 결과
{
  const r = merge([A]);
  check("한 장", summary(r), AB.slice(0, 3));
  check("한 장 겹침 없음", r.overlapped, 0);
  check("0장", merge([]), { expenses: [], excludedIncome: 0, overlapped: 0 });
}

// ── 날짜 헤더가 아예 없는 장(하루치가 한 화면을 넘음): 겹치는 거래로 자리를 찾음 ──
// P1: 6/7 ~ 6/6 앞부분, P2: 6/6 중간(헤더 없음), P3: 6/6 끝 ~ 6/5
const P1 = `
6월 7일 일요일
스타벅스 -5,500원
16:38 1,000,000원
6월 6일 토요일
쿠팡 -19,800원
21:05 1,005,500원
이마트 -45,200원
18:40 1,025,300원
`;
const P2 = `
이마트 -45,200원
18:40 1,025,300원
카카오T 택시 -8,700원
15:10 1,070,500원
메가커피 -2,000원
12:00 1,079,200원
`;
const P3 = `
메가커피 -2,000원
12:00 1,079,200원
CU -3,600원
08:10 1,081,200원
6월 5일 금요일
맥도날드 -7,900원
12:10 1,084,800원
`;
const P123 = ["스타벅스|5500|06-07", "쿠팡|19800|06-06", "이마트|45200|06-06", "카카오T 택시|8700|06-06",
  "메가커피|2000|06-06", "CU|3600|06-06", "맥도날드|7900|06-05"];

// 9) 순서대로 고른 경우
{
  const r = merge([P1, P2, P3]);
  check("헤더 없는 장(순서대로)", summary(r), P123);
  check("헤더 없는 장(순서대로) 겹친 건수", r.overlapped, 2);
}

// 10) 거꾸로 고른 경우: 헤더 없는 P2를 겹침(이마트)으로 P1 바로 뒤에 놓아, 날짜(6/6)도 맞게 이어받음
{
  const r = merge([P3, P2, P1]);
  check("헤더 없는 장(거꾸로)", summary(r), P123);
  check("헤더 없는 장(거꾸로) 겹친 건수", r.overlapped, 2);
}

// 11) 뒤섞어 고른 경우
{
  const r = merge([P2, P3, P1]);
  check("헤더 없는 장(뒤섞음)", summary(r), P123);
}

// 12) 겹치는 장이 없는 헤더 없는 장은 바로 앞에 고른 장 뒤에 (못 찾으면 고른 순서를 믿음)
{
  const lone = `
배달의민족 -23,000원
19:30 2,000,000원
`;
  const r = merge([A, lone]);
  check("겹침 없는 헤더 없는 장", summary(r).slice(-1), ["배달의민족|23000|06-06"]);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
