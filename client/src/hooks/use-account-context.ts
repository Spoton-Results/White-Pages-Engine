/**
 * use-account-context.ts
 *
 * Agency / Client selection that survives:
 *   - React StrictMode double-renders
 *   - Vite HMR module re-evaluations
 *   - wouter route changes
 *   - Railway sandboxed iframe (localStorage is blocked)
 *
 * Strategy: store on window.__nexusSession (a plain object attached to the
 * global). This is the only reliable cross-render, cross-HMR store that
 * works without localStorage in an iframe sandbox.
 *
 * Falls back to localStorage for local-dev convenience when window is
 * available and localStorage is not blocked.
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

// ── Keys ────────────────────────────────────────────────────────────────────
export const STORAGE_KEY_AGENCY  = "nexus_selected_agency_id";
export const STORAGE_KEY_ACCOUNT = "nexus_selected_account_id";

// ── Global session singleton ─────────────────────────────────────────────────
// Attach to window so it is shared across HMR reloads and React StrictMode
// double-invocations. Falls back to a module Map when window is unavailable
// (e.g. SSR / test environments).
type NexusSession = { [key: string]: string };

function getSession(): NexusSession {
  if (typeof window === "undefined") return {};
  if (!(window as any).__nexusSession) {
    (window as any).__nexusSession = {} as NexusSession;
  }
  return (window as any).__nexusSession as NexusSession;
}

/**
 * Read a value — checks window.__nexusSession first, then localStorage.
 */
export function loadFromStorage(key: string): string | null {
  // 1. In-memory window session (primary — always works in Railway iframe)
  const session = getSession();
  if (key in session) return session[key];

  // 2. localStorage fallback (local dev where it's not blocked)
  try {
    const val = localStorage.getItem(key);
    if (val !== null) {
      // Promote to session store so future reads are fast
      session[key] = val;
    }
    return val;
  } catch {
    return null;
  }
}

/**
 * Write a value — always writes to window.__nexusSession; also tries
 * localStorage as a best-effort secondary store for local dev.
 */
export function saveToStorage(key: string, value: string | null): void {
  const session = getSession();

  if (value === null) {
    delete session[key];
  } else {
    session[key] = value;
  }

  // Best-effort localStorage sync
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Silently ignored in sandboxed environments
  }
}
