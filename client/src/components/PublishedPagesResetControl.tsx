import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAccountContext } from "@/hooks/use-account-context";

export default function PublishedPagesResetControl() {
  const [location] = useLocation();
  const { selectedAccountId } = useAccountContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState("");

  if (!location.startsWith("/published")) return null;

  const websitesUrl = selectedAccountId ? `/api/accounts/${selectedAccountId}/websites` : "/api/websites";
  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites", selectedAccountId, "published-reset-control"],
    queryFn: () => api.get<any[]>(websitesUrl),
  });

  const selectedWebsite = websiteId || (websites as any[])[0]?.id || "";
  const currentWebsite = useMemo(
    () => (websites as any[]).find((website: any) => website.id === selectedWebsite),
    [websites, selectedWebsite],
  );

  const resetPages = useMutation({
    mutationFn: () => api.delete<any>(`/api/websites/${selectedWebsite}/pages/purge`),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/pages/published"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Published pages reset complete",
        description: `${result?.deleted?.pages ?? 0} pages and ${result?.deleted?.sitemaps ?? 0} sitemap rows reset for this website.`,
      });
    },
    onError: (error: any) => toast({ title: "Reset failed", description: error.message, variant: "destructive" }),
  });

  const runReset = () => {
    if (!selectedWebsite || resetPages.isPending) return;
    const label = currentWebsite?.settings?.parentDomain || currentWebsite?.domain || selectedWebsite;
    const confirmed = window.confirm(`Delete all published pages and sitemap rows for ${label}?\n\nAccounts, websites, services, locations, brand profiles, images, blueprints, and query clusters stay unchanged.`);
    if (!confirmed) return;
    resetPages.mutate();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-background p-3 shadow-lg sm:flex-row sm:items-center">
      <Select value={selectedWebsite} onValueChange={setWebsiteId}>
        <SelectTrigger className="h-9 w-64 max-w-full" data-testid="select-reset-published-website">
          <SelectValue placeholder="Select website" />
        </SelectTrigger>
        <SelectContent>
          {(websites as any[]).map((website: any) => (
            <SelectItem key={website.id} value={website.id}>
              {website.settings?.parentDomain || website.domain}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="destructive"
        size="sm"
        onClick={runReset}
        disabled={!selectedWebsite || resetPages.isPending}
        data-testid="button-reset-published-pages"
      >
        {resetPages.isPending ? "Deleting..." : "Delete All Published Pages"}
      </Button>
    </div>
  );
}
