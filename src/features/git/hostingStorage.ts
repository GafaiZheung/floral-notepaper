/**
 * Shared storage for Git hosting accounts (GitHub/GitLab).
 * Uses localStorage for persistence across components.
 */
import type { GitHostingAccount } from "./types";

const STORAGE_KEY = "floral:git-hosting-accounts";

export function loadHostingAccounts(): GitHostingAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GitHostingAccount[];
  } catch {
    return [];
  }
}

export function saveHostingAccounts(accounts: GitHostingAccount[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}
