// 빈도 기반(라이트너 박스 방식) 학습 엔진
// 날짜/시간이 아니라 "얼마나 자주 다시 등장하는가"로 복습을 조절합니다.
// quality: 0=다시, 3=어려움, 4=좋음, 5=쉬움
//
// box 1(다시 누른 단어) ~ box 5(완전히 익힌 단어)
// 박스가 낮을수록 복습 세션에 더 여러 번 포함되어 자주 등장합니다.

const MIN_BOX = 1;
const MAX_BOX = 5;

export function createInitialRecord(wordId) {
  return {
    wordId,
    box: MIN_BOX,
    reviewCount: 0,
    lastQuality: null,
    lastReviewed: null,
  };
}

export function review(record, quality) {
  let box = record.box || MIN_BOX;

  if (quality < 3) {
    box = MIN_BOX; // 다시: 가장 자주 등장하는 상태로 리셋
  } else if (quality === 3) {
    box = Math.max(MIN_BOX, box - 1); // 어려움: 한 단계 낮춰 더 자주 등장
  } else if (quality === 4) {
    box = Math.min(MAX_BOX, box + 1); // 좋음: 한 단계 올려 조금 덜 등장
  } else {
    box = Math.min(MAX_BOX, box + 2); // 쉬움: 두 단계 올려 훨씬 덜 등장
  }

  return {
    ...record,
    box,
    reviewCount: (record.reviewCount || 0) + 1,
    lastQuality: quality,
    lastReviewed: new Date().toISOString(),
  };
}

export function isMastered(record) {
  return !!record && record.box >= MAX_BOX && (record.reviewCount || 0) >= 2;
}

// 박스별로 복습 세션에 몇 번 포함시킬지 결정 (모르는 단어일수록 여러 번 포함)
const BOX_REPEATS = { 1: 5, 2: 3, 3: 2, 4: 1 };
const MASTERED_INCLUDE_PROB = 0.3; // 완전히 익힌 단어도 가끔은 장기 기억 확인용으로 포함

export function repeatCountForBox(box) {
  const b = box || MIN_BOX;
  if (b >= MAX_BOX) {
    return Math.random() < MASTERED_INCLUDE_PROB ? 1 : 0;
  }
  return BOX_REPEATS[b] || 1;
}

export function boxLabel(box) {
  const b = box || MIN_BOX;
  if (b <= 1) return "매우 자주 등장";
  if (b === 2) return "자주 등장";
  if (b === 3) return "가끔 등장";
  if (b === 4) return "드물게 등장";
  return "거의 등장 안 함";
}
