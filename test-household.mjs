// 검증 스크립트: node test-household.mjs
import { isValidHid } from "./src/household.js";

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}\n   기대: ${expected}\n   실제: ${got}`); }
}

// 정상 코드 (실제로 발급되는 형태)
check("UUID 허용", isValidHid("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
check("base36 폴백 허용", isValidHid("k9f3a1b2c4d5e6"), true);
check("밑줄·하이픈 허용", isValidHid("fam_ABC-123"), true);

// 경로를 깨뜨리는/이상한 코드 거부
check("슬래시 거부(경로 인젝션)", isValidHid("a/b/c"), false);
check("상위경로 거부", isValidHid("../../etc"), false);
check("공백 거부", isValidHid("code with space"), false);
check("빈 문자열 거부", isValidHid(""), false);
check("제어문자 거부", isValidHid("a\nb"), false);
check("한글 등 비허용 문자 거부", isValidHid("가족코드"), false);
check("null 거부", isValidHid(null), false);
check("숫자 타입 거부", isValidHid(12345), false);

// 길이 상한 (Firestore 세그먼트 보호)
check("128자 허용", isValidHid("a".repeat(128)), true);
check("129자 거부", isValidHid("a".repeat(129)), false);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
