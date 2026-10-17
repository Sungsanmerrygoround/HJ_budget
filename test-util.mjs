// 검증 스크립트 공용 도우미: check로 하나씩 비교하고, 마지막에 done()으로 결과를 출력하고 끝냅니다.
import { isDeepStrictEqual, inspect } from "node:util";

let pass = 0, fail = 0;

/** got이 expected와 속까지 같은지 확인 (undefined와 null, 1과 "1"도 구분) */
export function check(name, got, expected) {
  if (isDeepStrictEqual(got, expected)) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}\n   기대: ${show(expected)}\n   실제: ${show(got)}`);
  }
}

/** 결과를 출력하고, 하나라도 실패했으면 실패 코드로 끝냅니다. */
export function done() {
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}

const show = (v) => inspect(v, { depth: null, breakLength: Infinity });
