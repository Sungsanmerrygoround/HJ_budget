// 검증 스크립트: node test-aggregate.mjs
import { check, done } from "./test-util.mjs";
import { sumAmount, categoryTotals, rankedCategories } from "./src/aggregate.js";
import { CATS } from "./src/categorize.js";

const entries = [
  { category: "외식비", amount: 5000 },
  { category: "외식비", amount: 3000 },
  { category: "교통비", amount: 2000 },
  { category: "기타", amount: 1000 },
];

// sumAmount: 전체 합
check("sumAmount 합계", sumAmount(entries), 11000);
check("sumAmount 빈 배열", sumAmount([]), 0);

// categoryTotals: CATS 순서대로, 각 카테고리 합
const totals = categoryTotals(entries);
check("categoryTotals 길이 = CATS", totals.length, CATS.length);
check("categoryTotals 외식비", totals[CATS.indexOf("외식비")], 8000);
check("categoryTotals 교통비", totals[CATS.indexOf("교통비")], 2000);
check("categoryTotals 없는 카테고리는 0", totals[CATS.indexOf("취미")], 0);

// CATS에 없는 카테고리는 무시(기존 filter 동작과 동일)
check("categoryTotals 알 수 없는 카테고리 무시",
  categoryTotals([{ category: "외계", amount: 999 }]).reduce((a, b) => a + b, 0), 0);

// rankedCategories: 지출 있는 것만, 큰 순
check("rankedCategories 정렬/필터",
  rankedCategories(entries).map((r) => `${r.cat}|${r.total}`),
  ["외식비|8000", "교통비|2000", "기타|1000"]);
check("rankedCategories 빈 배열", rankedCategories([]), []);

// 옛 데이터에 문자로 저장된 금액이 섞여도 숫자로 더함 (예전엔 "3000"이 이어붙여져 합계가 깨졌음)
const mixed = [{ category: "외식비", amount: 5000 }, { category: "외식비", amount: "3000" }, { category: "기타", amount: undefined }];
check("sumAmount 문자 금액", sumAmount(mixed), 8000);
check("categoryTotals 문자 금액", categoryTotals(mixed)[CATS.indexOf("외식비")], 8000);

done();
