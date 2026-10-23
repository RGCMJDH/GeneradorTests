export const MIN_BYTES: number
export function verifyTessdataFile(path: string, expectedSha256: string): { ok: boolean; reason?: string }
export function verifyBundle(dir: string, hashes: Record<string, string>, langs: string[]): string[]
