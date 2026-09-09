/**
 * crypto.randomUUID() only works in secure contexts (HTTPS or localhost),
 * so it throws when this app is served over plain HTTP on a LAN IP.
 */
export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
