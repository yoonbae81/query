// 첫 페인트 전에 테마를 적용한다(깜빡임 방지). 서버 CSP가 인라인 스크립트를 막으므로 정적 파일로 둔다.
// 저장 키 'query_theme'는 src/lib/theme.ts와 맞춰야 한다.
(function () {
  var resolved = "dark";
  try {
    var mode = localStorage.getItem("query_theme");
    if (mode === "light" || mode === "dark") {
      resolved = mode;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      resolved = "light";
    }
  } catch (e) {
    /* localStorage 접근 불가 시 dark */
  }
  document.documentElement.dataset.theme = resolved;
  var meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f8fafc" : "#0b0f19");
})();
