/** True when a request path belongs to the Express API; everything else goes to Next.js. */
export function isApiPath(url: string | undefined): boolean {
  const path = (url ?? "/").split("?")[0] ?? "/";
  return path === "/api" || path.startsWith("/api/");
}
