/**
 * use-account-context.ts
 *
 * NOTE: localStorage is blocked in the Railway sandboxed iframe environment —
 * calls silently return null on every page load, causing all "Select account"
 * dropdowns to reset to empty even though the accounts exist in the database.
 *
 * Fix: use a module-level in-memory Map instead. Selection persists for the
 * lifetime of the browser session (survives React re-renders and route changes)
 * without requiring any storage access.
 */
import { createContext, useContext } from "react";

export interface AccountContextValue {
  selectedAgencyId: string | null;
  selectedAccountId: string | null;
  setSelectedAgencyId: (id: string | null) => void;
  setSelectedAccountId: (id: string | null) => void;
}

export const AccountContext = createContext<AccountContextValue>({
  selectedAgencyId: null,
  selectedAccountId: null,
  setSelectedAgencyId: () => {},
  setSelectedAccountId: () => {},
});

export function useAccountContext(): AccountContextValue {
  return useContext(AccountContext);
}

// ── In-memory session store (replaces localStorage) ──────────────────────────────
// Module-level Map: lives as long as the JS bundle is loaded in the tab.
// Cleared on hard refresh / tab close — acceptable for admin session state.
const _memStore = new Map<string, string>();

export const STORAGE_KEY_AGENCY = "nexus_selected_agency_id";
export const STORAGE_KEY_ACCOUNT = "nexus_selected_account_id";

/**
 * Read a value from the in-memory store.
 * Falls back to localStorage as a best-effort secondary source
 * (e.g. local dev where localStorage works fine).
 */
export function loadFromStorage(key: string): string | null {
  // In-memory first (Railway / sandboxed environments)
  const memVal = _memStore.get(key);
  if (memVal !== undefined) return memVal;

  // localStorage fallback (local dev)
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a value to both the in-memory store and localStorage.
 * The in-memory write always succeeds; the localStorage write may
 * silently fail in sandboxed environments — that is expected and safe.
 */
export function saveToStorage(key: string, value: string | null): void {
  // Always update in-memory store
  if (value === null) {
    _memStore.delete(key);
  } else {
    _memStore.set(key, value);
  }

  // Best-effort localStorage sync (for local dev convenience)
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Silently ignored in sandboxed environments
  }
}
