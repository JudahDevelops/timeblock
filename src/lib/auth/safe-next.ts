/**
 * Only allow redirects to our own paths. Without this, `?next=https://evil.com`
 * would turn sign-in into an open redirect.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";
  // Reject protocol-relative (`//host`, `/\host`) and absolute URLs alike.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
