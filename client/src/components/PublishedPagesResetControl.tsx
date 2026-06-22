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

  const accountWebsitesUrl = selectedAccountId ? `/api/accounts/${selectedAccountId}/websites` : "/api/websites";
  const { data: accountWebsites = [] } = useQuery({
    queryKey: ["/api/websites", selectedAccountId, "published-reset-control"],
    queryFn: () => api.get<any[]>(accountWebsitesUrl),
    enabled: location.startsWith("/published"),
  });

  const { data: allWebsites = [] } = useQuery({
    queryKey: ["/api/websites", "published-reset-control-fallback"],
    queryFn: () => api.get<any[]>("/api/websites"),
    enabled: location.startsWith("/published") && (accountWebsites as any[]).length === 0,
  });

  const websites = (accountWebsites as any[]).length > 0 ? (accountWebsites as any[]) : (allWebsites as any[]);
  const selectedWebsite = websiteId || websites[0]?.id || "";
  const currentWebsite = useMemo(
    () => websites.find((website: any) => website.id === selectedWebsite),
    [websites, selectedWebsite],
  );

  const resetPages = useMutation({
    mutationFn: () => api.delete<any>(`/api/websites/${selectedWebsite}/pages/purge`),
    onMutate: () => {
      toast({ title: "Deleting published pages...", description: "Do not refresh this page until it finishes." });
    },
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
    if (!selectedWebsite) {
      toast({ title: "Select a website first", variant: "destructive" });
      return;
    }
    if (resetPages.isPending) return;
    const label = currentWebsite?.settings?.parentDomain || currentWebsite?.domain || selectedWebsite;
    const confirmed = window.confirm(`Delete all published pages and sitemap rows for ${label}?\n\nAccounts, websites, services, locations, brand profiles, images, blueprints, and query clusters stay unchanged.`);
    if (!confirmed) return;
    resetPages.mutate();
  };

  if (!location.startsWith("/published")) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border bg-background p-3 shadow-lg sm:flex-row sm:items-center">
      <Select value={selectedWebsite} onValueChange={setWebsiteId}>
        <SelectTrigger className="h-9 w-64 max-w-full" data-testid="select-reset-published-website">
          <SelectValue placeholder="Select website" />
        </SelectTrigger>
        <SelectContent>
          {websites.map((website: any) => (
            <SelectItem key={website.id} value={website.id}>
              {website.settings?.parentDomain || website.domain}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="destructive"
        size="sm"
        onClick={(event) => { event.preventDefault(); runReset(); }}
        disabled={resetPages.isPending}
        data-testid="button-reset-published-pages"
      >
        {resetPages.isPending ? "Deleting..." : "Delete All Published Pages"}
      </Button>
    </div>
  );
}
