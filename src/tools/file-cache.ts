import { readFile } from "fs/promises";
import { createHash } from "crypto";

interface CacheEntry {
  content: string;
  hash: string;
  lines: string[];
}

class FileCache {
  private cache = new Map<string, CacheEntry>();

  private computeHash(content: string): string {
    return createHash("md5").update(content).digest("hex");
  }

  get(filePath: string): CacheEntry | null {
    return this.cache.get(filePath) ?? null;
  }

  set(filePath: string, content: string): CacheEntry {
    const entry: CacheEntry = {
      content,
      hash: this.computeHash(content),
      lines: content.split("\n"),
    };
    this.cache.set(filePath, entry);
    return entry;
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  async hasChanged(filePath: string): Promise<boolean> {
    const cached = this.cache.get(filePath);
    if (!cached) return true;
    try {
      const current = await readFile(filePath, "utf-8");
      return this.computeHash(current) !== cached.hash;
    } catch {
      return true;
    }
  }
}

export const fileCache = new FileCache();
