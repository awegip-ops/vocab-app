// 순수 유틸 함수 (DOM/전역 상태 의존 없음)

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

export function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function freqBadge(word) {
  const f = word.freq || 3;
  if (f === 1) return `<span class="freq-badge freq-1" title="최빈출">⭐⭐⭐</span>`;
  if (f === 2) return `<span class="freq-badge freq-2" title="빈출">⭐⭐</span>`;
  return `<span class="freq-badge freq-3" title="보통">⭐</span>`;
}
