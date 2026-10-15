/**
 * Where verified catalogue images are kept: files under <dataDir>/media in Electron,
 * IndexedDB blobs in the web app. The locator returned by put() is stored in media_cache.path.
 */
export interface MediaStore {
  exists(locator: string): boolean;
  put(checksum: string, mime: string, bytes: Uint8Array): Promise<string>;
}

export const MEDIA_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
