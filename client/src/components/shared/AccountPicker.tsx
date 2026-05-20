/**
 * AccountPicker — reusable account selector bar used at the top of every
 * feature page (Services, Blueprints, Clusters, Locations, Brand Profiles).
 *
 * Reads and writes to AccountContext so selection persists across page navigation.
 */
import { useAccountContext } from "@/contexts/account-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";

interface AccountPickerProps {
  /** Label shown after the account name, e.g. "3 services" */
  countLabel?: string;
  className?: string;
}

export function AccountPicker({ countLabel, className }: AccountPickerProps) {
  const { accounts, accountsLoading, selectedAccountId, setSelectedAccountId } = useAccountContext();

  if (accountsLoading) {
    return (
      <div className={`flex items-center gap-3 bg-card p-3 rounded-lg border ${className ?? ""}`}>
        <Skeleton className="h-9 w-64" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className={`flex items-center gap-3 bg-card p-3 rounded-lg border text-sm text-muted-foreground ${className ?? ""}`}>
        <Building2 className="size-4" />
        No accounts found. Create an account first.
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 bg-card p-3 rounded-lg border ${className ?? ""}`}>
      <Building2 className="size-4 text-muted-foreground shrink-0" />
      <Select
        value={selectedAccountId}
        onValueChange={setSelectedAccountId}
      >
        <SelectTrigger className="w-64" data-testid="account-picker-trigger">
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id} data-testid={`account-option-${a.id}`}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {countLabel && (
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      )}
    </div>
  );
}
