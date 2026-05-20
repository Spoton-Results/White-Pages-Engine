/**
 * AccountContext — single source of truth for the currently selected account.
 * All feature pages (Services, Blueprints, Clusters, Locations, Brand Profiles)
 * read from and write to this context so they stay in sync across navigation.
 *
 * The selected account is stored in memory (not localStorage, which is blocked
 * in the Railway sandbox). It automatically falls back to the first account when
 * the list loads and the user hasn't explicitly chosen one yet.
 */
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Account {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  [key: string]: any;
}

interface AccountContextValue {
  accounts: Account[];
  accountsLoading: boolean;
  selectedAccountId: string;
  selectedAccount: Account | null;
  setSelectedAccountId: (id: string) => void;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  accountsLoading: true,
  selectedAccountId: "",
  selectedAccount: null,
  setSelectedAccountId: () => {},
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
    staleTime: 30_000,
  });

  // Auto-select the first account once loaded — only if user hasn't picked one
  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount =
    (accounts as Account[]).find((a) => a.id === selectedAccountId) ?? null;

  return (
    <AccountContext.Provider
      value={{
        accounts: accounts as Account[],
        accountsLoading,
        selectedAccountId,
        selectedAccount,
        setSelectedAccountId,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccountContext() {
  return useContext(AccountContext);
}
