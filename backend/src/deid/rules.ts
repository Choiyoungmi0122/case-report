export const PHONE_REGEX = /(?<![A-Za-z0-9-])(?:(?:\+?82[-\s]?1\d|(?:\+?82[-\s]?)?0\d{1,2})[-\s]?\d{3,4}[-\s]?\d{4})(?![A-Za-z0-9-])/g;
export const RESIDENT_ID_REGEX = /\b\d{6}[-\s]?[1-4]\d{6}\b/g;
export const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
export const DATE_REGEXES = [
  /(?:19|20)\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g,
  /(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}/g,
  /\d{1,2}\s*월\s*\d{1,2}\s*일/g
];

export const PATIENT_ID_REGEXES = [
  /(?:(?:환자번호|등록번호|차트번호|병록번호|ID)\s*[:#]?\s*)([A-Za-z0-9-]{4,})/gi
];

export const PATIENT_NAME_REGEXES = [
  /(?:^|[\s,])((?:\uAE40|\uC774|\uBC15|\uCD5C|\uC815|\uAC15|\uC870|\uC724|\uC7A5|\uC784|\uD55C|\uC624|\uC11C|\uC2E0|\uAD8C|\uD669|\uC548|\uC1A1|\uC804|\uD64D|\uC720|\uACE0|\uBB38|\uC591|\uC190|\uBC30|\uBC31|\uD5C8|\uB0A8|\uC2EC|\uB178|\uD558|\uACFD|\uC131|\uCC28|\uC8FC|\uC6B0|\uAD6C|\uBBFC|\uB958|\uB098|\uC9C4|\uC9C0|\uC5C4|\uCC44|\uC6D0|\uCC9C|\uBC29|\uACF5|\uD604|\uD568|\uBCC0|\uC5FC|\uC5EC|\uCD94|\uB3C4|\uC18C|\uC11D|\uC120|\uC124|\uB9C8|\uAE38|\uC704|\uD45C|\uBA85|\uAE30|\uBC18|\uC655|\uAE08|\uC625|\uC721|\uC778|\uB9F9|\uC81C|\uBAA8|\uD0C1|\uAD6D|\uC5B4|\uC740|\uD3B8)[\uAC00-\uD7A3]{1,3})(?=\s|$|(?:\uC740|\uB294|\uC774|\uAC00|\uC744|\uB97C|\uC5D0\uAC8C|\uC758)|[,. )])/g,
  /(?:^|[\s(:])([가-힣]{2,4})(?=\s*(?:\(\s*\d{1,3}\s*세\s*(?:남성|여성|남자|여자)\s*\)|\d{1,3}\s*세\s*(?:남성|여성|남자|여자)))/g,
  /(?:^|[\s,])(?:\d{1,3}\s*세\s*(?:남성|여성|남자|여자)\s+)([가-힣]{2,4})(?=\s*(?:은|는|이|가|을|를|,|\s))/g,
  // Explicit labels. 성명 / 성함 / 이름 are as unambiguous as 환자명, so adding
  // them raises recall without loosening the shape of the match.
  /(?:환자|환자명|성명|성함|이름)\s*[:：]?\s*([가-힣]{2,4})/g,
  /(?:^|[\s(])([가-힣]{2,4})(?=\s*(?:환자|씨|님))/g
];

/**
 * 이미 비식별된 기록(실험용 Write)용 이름 규칙. 참여자가 이름을 지우고 올리므로
 * 표지가 분명한 경우("환자명: 홍길동", "45세 남성 홍길동")만 가린다. 성씨 모양만으로
 * 가리는 첫 규칙은 약재(백두구, 오미자)와 일반 단어(기록일, 지금은)를 이름으로 잡고,
 * "OO 환자" 규칙은 병명("심방세동 환자")을 잡아서 쓰지 않는다 (사용자 결정 2026-10-11).
 */
export const PATIENT_NAME_REGEXES_ANONYMIZED_RECORD = [
  PATIENT_NAME_REGEXES[1],
  PATIENT_NAME_REGEXES[2],
  /(?:환자명|성명|성함|이름)\s*[:：]\s*([가-힣]{2,4})/g
];

export const DOCTOR_NAME_REGEXES = [
  /(?:^|[\s(])([가-힣]{2,4})(?=\s*(?:원장|교수|의사|한의사|선생님))/g
];

export const HOSPITAL_REGEXES = [
  /[가-힣A-Za-z0-9]+(?:대학)?(?:병원|의원|한의원|센터|클리닉)/g
];

/**
 * 기관 이름이 아닌 일반 시설 단어. HOSPITAL 규칙은 "한의원"을 "한" + "의원"으로 잡고
 * "타병원"도 기관명으로 본다. 이미 비식별된 기록(anonymized_record)에서는 이 단어들을
 * 그대로 둔다 ("타병원에서 홀터 검사 예정"은 임상 정보다).
 */
export const GENERIC_FACILITY_WORDS = new Set([
  '한의원', '의원', '병원', '대학병원', '종합병원', '요양병원', '치과의원', '보건소', '센터', '클리닉',
  '타병원', '타한의원', '타의원', '본원', '외부병원', '응급실', '한방병원', '양방병원'
]);

export const ADDRESS_REGEXES = [
  /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{0,30}(?:로|길|동|읍|면)\s*\d*/g
];

export const HIGH_RISK_RESIDUAL_REGEXES = [PHONE_REGEX, RESIDENT_ID_REGEX, EMAIL_REGEX];

export const DEFAULT_HOSPITAL_DICTIONARY = ['동의대병원', '서울대병원', '세브란스병원'];
