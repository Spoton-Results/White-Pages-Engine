import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCheck, Globe, RefreshCw, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function PublishQueuePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedWebsite, setSelectedWebsite] = useState<string>("");
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: pagesData, isLoading } = useQuery({
    queryKey: ["/api/pages/approved", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=approved`) : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/approved"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page published" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const publishAll = async () => {
    const pages = pagesData?.pages || [];
    for (const page of pages) {
      try {
        await api.post(`/api/pages/${page.id}/publish`, {});
      } catch {}
    }
    qc.invalidateQueries({ queryKey: ["/api/pages/approved"] });
    qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    toast({ title: `Published ${pages.length} pages` });
  };

  const pages = pagesData?.pages || [];

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Publish Queue</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Approved pages ready to publish live.</p>
          </div>
          {pages.length > 0 && (
            <Button className="gap-2" size="sm" onClick={publishAll}>
              <Zap className="size-4" />Publish All ({pages.length})
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setSelectedWebsite} value={selectedWebsite}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select website" />
            </SelectTrigger>
            <SelectContent>
              {websites.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pagesData && (
            <span className="text-sm text-muted-foreground">{pagesData.total} pages approved</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/pages/approved"] })}>
            <RefreshCw className="size-4" />
          </Button>
        </div>

        {!selectedWebsite ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Globe className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select a website to see its publish queue</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-3">
            <CheckCheck className="size-12 text-emerald-500/40" />
            <div>
              <h3 className="font-semibold">Publish queue is empty</h3>
              <p className="text-muted-foreground text-sm mt-1">Approve pages in Draft Review to add them here.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {pages.map((page: any) => (
              <div key={page.id} className="bg-card border rounded-lg p-4 flex items-center gap-4 hover:border-primary/30 transition-colors">
                <div className="size-2 rounded-full bg-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{page.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{page.slug}</div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>Score: <span className="text-emerald-600 font-medium">{(parseFloat(page.publishScore) * 100).toFixed(0)}%</span></span>
                    <span>Local: <span className="text-emerald-600 font-medium">{(parseFloat(page.localSignalScore) * 100).toFixed(0)}%</span></span>
                    <span>{page.wordCount} words</span>
                    <Badge variant="outline" className="text-[10px]">{page.pageType?.replace("_", " ")}</Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => publish.mutate(page.id)}
                  disabled={publish.isPending}
                >
                  <Globe className="size-3.5" />Publish
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
