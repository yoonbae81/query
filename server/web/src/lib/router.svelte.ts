/** 화면이 2개뿐이라 History API만 쓰는 작은 라우터. 경로는 <base href> 기준 상대 경로다. */

export type Route = { name: "home" } | { name: "detail"; id: string };

function baseDir(): string {
  return new URL(document.baseURI).pathname.replace(/\/?$/, "/");
}

export function parseRoute(pathname: string, base: string): Route {
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
  const m = rel.match(/^queries\/([^/]+)\/?$/);
  return m ? { name: "detail", id: decodeURIComponent(m[1]!) } : { name: "home" };
}

class Router {
  route = $state<Route>(parseRoute(location.pathname, baseDir()));

  constructor() {
    window.addEventListener("popstate", () => {
      this.route = parseRoute(location.pathname, baseDir());
    });
  }

  href(target: Route): string {
    return target.name === "home" ? baseDir() : `${baseDir()}queries/${encodeURIComponent(target.id)}`;
  }

  go(target: Route): void {
    history.pushState(null, "", this.href(target));
    this.route = target;
    window.scrollTo(0, 0);
  }
}

export const router = new Router();
