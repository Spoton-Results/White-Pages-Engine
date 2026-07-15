import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function PublishedPagesResetControl() {
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedWebsite, setSelectedWebsite] = useState("");

  useEffect(() => {
    // ✅ CHANGED: use the website ID from the active Published Pages table query.
    // This keeps bulk prune scoped to the same website currently shown on screen.
    const syncSelectedWebsite = () => {
      const activePublishedQueries = queryClient.getQueryCache().findAll({
        queryKey: ["/api/pages/published"],
        type: "active",
      });
      const activeQuery = activePublishedQueries[activePublishedQueries.length - 1];
      const websiteId = String(activeQuery?.queryKey?.[1] || "");
      setSelectedWebsite(websiteId);
    };

    syncSelectedWebsite();
    return queryClient.getQueryCache().subscribe(syncSelectedWebsite);
  }, [queryClient]);

  const { data: currentWebsite } = useQuery({
    queryKey: ["/api/websites", selectedWebsite, "published-prune-control"],
    queryFn: () => api.get<any>(`/api/websites/${selectedWebsite}`),
    enabled: location.startsWith("/published") && !!selectedWebsite,
  });

  const prunePages = useMutation({
    // 🔒 UNTOUCHED: existing website-scoped bulk prune route.
    mutationFn: () => api.post<any>(`/api/websites/${selectedWebsite}/pages/prune-all-published`, {}),
    onMutate: () => {
      toast({ title: "Starting published page prune...", description: "The pages will be marked as pruned in the background." });
    },
    onSuccess: () => {
      toast({
        title: "Published page prune started",
        description: "Published pages are being marked as pruned in the background. Check Railway logs for progress before refreshing.",
      });
    },
    onError: (error: any) => toast({ title: "Prune failed", description: error.message, variant: "destructive" }),
  });

  const runPrune = () => {
    if (!selectedWebsite) {
      toast({ title: "Wait for the Published Pages website to load", variant: "destructive" });
      return;
    }
    if (prunePages.isPending) return;
    const label = currentWebsite?.settings?.parentDomain || currentWebsite?.domain || selectedWebsite;
    const confirmed = window.confirm(`Prune all published pages for ${label}?\n\nThis uses the same pruned status as the row-level Prune action. Page records and versions stay in the database. Accounts, websites, services, locations, brand profiles, images, blueprints, and query clusters stay unchanged.`);
    if (!confirmed) return;
    prunePages.mutate();
  };

  if (!location.startsWith("/published")) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border bg-background p-3 shadow-lg">
      <span className="max-w-64 truncate text-sm text-muted-foreground">
        {currentWebsite?.settings?.parentDomain || currentWebsite?.domain || "Loading selected website..."}
      </span>
      <Button
        variant="destructive"
        size="sm"
        onClick={(event) => { event.preventDefault(); runPrune(); }}
        disabled={prunePages.isPending || !selectedWebsite}
        data-testid="button-prune-published-pages"
      >
        {prunePages.isPending ? "Starting..." : "Prune All Published Pages"}
      </Button>
    </div>
  );
}
