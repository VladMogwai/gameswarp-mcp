const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';

/**
 * The fallback path, correct only for older apps. Anything released recently
 * carries a content hash in its image URL and cannot be addressed this way, so
 * the stored URL from the store details is used when there is one - see
 * `coverUrl` below.
 */
export function capsuleUrl(appid: number): string {
  return `${CDN}/${appid}/capsule_231x87.jpg`;
}

export function headerUrl(appid: number): string {
  return `${CDN}/${appid}/header.jpg`;
}

/**
 * Prefers the URL Steam gave us and falls back to the legacy fixed path, which
 * still works for the back catalogue. A game with neither returns 404 and the
 * browser leaves an empty box, which is the right outcome and needs no code.
 */
export function coverUrl(
  appid: number,
  stored: string | null | undefined,
  size: 'row' | 'hero',
): string {
  if (stored !== null && stored !== undefined && stored.length > 0) return stored;
  return size === 'row' ? capsuleUrl(appid) : headerUrl(appid);
}
