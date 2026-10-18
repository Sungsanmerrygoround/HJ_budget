// 검증 스크립트: node test-categorize.mjs
import { check, done } from "./test-util.mjs";
import { categorize, normMerchant } from "./src/categorize.js";

const cat = (names) => names.map(categorize);

// 흔한 가맹점 (캡쳐에 찍히는 모양 그대로: 영문 대문자·지점명·법인명)
check("외식비", cat(["STARBUCKS 강남", "메가MGC커피", "(주)우아한형제들", "버거킹", "서브웨이", "본도시락", "역전할머니맥주"]), Array(7).fill("외식비"));
check("생필품", cat(["CU 성수2가점", "CU성수점", "7-ELEVEN 역삼점", "emart24", "쿠팡", "SSG.COM", "GS더프레시"]), Array(7).fill("생필품"));
check("교통비", cat(["카카오T 택시", "티머니", "GS칼텍스", "SK에너지", "고속도로 통행료", "공항철도"]), Array(6).fill("교통비"));
check("취미", cat(["CGV 왕십리", "방탈출카페", "버스킹 공연", "인터파크티켓", "STEAM"]), Array(5).fill("취미"));
check("자기계발비", cat(["교보문고", "영풍문고", "토익 응시료", "스터디카페"]), Array(4).fill("자기계발비"));
check("고정비", cat(["NETFLIX.COM", "SK텔레콤", "한국전력공사", "YouTube Premium", "Apple.com/bill", "쿠팡와우", "지니뮤직", "SK브로드밴드"]), Array(8).fill("고정비"));

// 더 긴(구체적인) 키워드가 이김
check("쿠팡이츠는 외식비(쿠팡보다 구체적)", categorize("쿠팡이츠"), "외식비");
check("노브랜드버거는 외식비(노브랜드 마트가 아님)", categorize("노브랜드버거"), "외식비");
check("멜론티켓은 취미(멜론 구독이 아님)", categorize("멜론티켓"), "취미");

// 우연히 키워드를 품은 이름은 다른 분류로 가지 않음
check("스마트스토어의 '마트'", categorize("네이버 스마트스토어"), "기타");
check("Curry의 'cu'", categorize("Curry House 성수"), "외식비");
check("skt의 'kt'는 따로 보지 않음(그래도 고정비)", categorize("SKT 통신요금"), "고정비");
check("ktx는 교통비(kt가 아님)", categorize("코레일 KTX"), "교통비");
check("모르는 이름·빈 값은 기타", cat(["무명상점", "", null]), ["기타", "기타", "기타"]);

// 학습 키: 띄어쓰기·대소문자·기호를 무시
check("normMerchant", normMerchant("GS25 역삼점 (1층)"), normMerchant("gs25역삼점1층"));

done();
