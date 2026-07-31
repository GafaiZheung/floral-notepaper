export function normalizePathForCompare(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase()
    .replace(/\\/g, "/");
}

export function dedupeNoteDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const key = normalizePathForCompare(dir);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(dir);
    }
  }
  return result;
}

export function displayPathLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function parentDirFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
}
