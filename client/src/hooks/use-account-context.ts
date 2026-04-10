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

export const STORAGE_KEY_AGENCY = "nexus_selected_agency_id";
export const STORAGE_KEY_ACCOUNT = "nexus_selected_account_id";

export function loadFromStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function saveToStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
