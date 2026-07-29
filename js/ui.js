// 화면 전반에서 쓰는 토스트/확인 모달 (특정 화면에 종속되지 않음)
import { escapeHtml } from "./utils.js?v=1";

let toastTimer = null;
export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// window.confirm 대신 쓰는 페이지 내장 확인 모달
export function showConfirm(message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-msg">${escapeHtml(message)}</div>
      <div class="modal-actions">
        <button class="btn modal-cancel">취소</button>
        <button class="btn btn-primary modal-ok">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-ok").addEventListener("click", () => {
    close();
    onConfirm();
  });
}
