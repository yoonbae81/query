/** REST/MCP용 API_TOKEN을 브라우저에 보관한다(이 브라우저의 localStorage). 서버에 API_TOKEN이 없으면 쓰이지 않는다. */
const KEY = "query.apiToken";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장소를 쓸 수 없으면 이번 세션에서만 다시 묻는다 */
  }
}
