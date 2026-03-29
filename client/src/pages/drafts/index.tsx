import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Eye, FileText, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function DraftsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedWebsite, setSelectedWebsite] = useState<string>("");
  const [previewPage, setPreviewPage] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<any>(null);

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: pagesData, isLoading } = useQuery({
    queryKey: ["/api/pages/review", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=review`) : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/review"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page approved for publish queue" });
    },
  });

  const prune = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/prune`, { reason: "Pruned from draft review" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/review"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page pruned" });
    },
  });

  const handlePreview = async (page: any) => {
    setPreviewPage(page);
    try {
      const data = await api.get<any>(`/api/pages/${page.id}`);
      setPreviewContent(data);
    } catch (err: any) {
      toast({ title: "Could not load page content", description: err.message, variant: "destructive" });
    }
  };

  const pages = pagesData?.pages || [];

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Draft Review</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Review AI-generated pages before publishing.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/pages/review"] })}>
            <RefreshCw className="size-4 mr-2" />Refresh
          </Button>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setSelectedWebsite} value={selectedWebsite}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select website to review" />
            </SelectTrigger>
            <SelectContent>
              {websites.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pagesData && (
            <span className="text-sm text-muted-foreground">
              {pagesData.total} pages awaiting review
            </span>
          )}
        </div>

        {!selectedWebsite ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <FileText className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select a website to review its draft pages</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3 border rounded-lg bg-card">
            <Check className="size-12 text-emerald-500/50" />
            <div>
              <h3 className="font-semibold">No pages in review</h3>
              <p className="text-muted-foreground text-sm mt-1">All caught up! Run a generation job to create new pages.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {pages.map((page: any) => (
              <div key={page.id} className="bg-card border rounded-lg p-4 hover:border-primary/30 transition-colors"
                data-testid={`draft-page-${page.id}`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm truncate">{page.title}</h3>
                      {!page.passedQa && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs shrink-0">
                          <AlertCircle className="size-3 mr-1" />QA Issues
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{page.slug}</div>
                    <div className="flex items-center gap-4 mt-2 text-xs">
                      <span className="text-muted-foreground">
                        Publish Score: <span className={`font-semibold ${parseFloat(page.publishScore) >= 0.7 ? "text-emerald-600" : "text-amber-600"}`}>
                          {(parseFloat(page.publishScore) * 100).toFixed(0)}%
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Local Signal: <span className={`font-semibold ${parseFloat(page.localSignalScore) >= 0.6 ? "text-emerald-600" : "text-amber-600"}`}>
                          {(parseFloat(page.localSignalScore) * 100).toFixed(0)}%
                        </span>
                      </span>
                      <span className="text-muted-foreground">Words: <span className="font-semibold">{page.wordCount}</span></span>
                      <span className="text-muted-foreground capitalize">{page.pageType?.replace("_", " ")}</span>
                    </div>
                    {page.qaReport?.issues?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {page.qaReport.issues.map((issue: string, i: number) => (
                          <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">{issue}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => handlePreview(page)}>
                      <Eye className="size-4 mr-1" />Preview
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => approve.mutate(page.id)} disabled={approve.isPending}>
                      <Check className="size-4 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => prune.mutate(page.id)} disabled={prune.isPending}>
                      <X className="size-4 mr-1" />Prune
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!previewPage} onOpenChange={() => { setPreviewPage(null); setPreviewContent(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base truncate">{previewPage?.title}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="content" className="flex-1 flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="meta">Meta / SEO</TabsTrigger>
              <TabsTrigger value="qa">QA Report</TabsTrigger>
            </TabsList>
            <ScrollArea className="flex-1 mt-2">
              <TabsContent value="content" className="mt-0">
                {previewContent?.activeVersion ? (
                  <div className="prose prose-sm max-w-none p-4 border rounded-lg bg-white"
                    dangerouslySetInnerHTML={{ __html: previewContent.activeVersion.contentHtml }} />
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">No content version available</div>
                )}
              </TabsContent>
              <TabsContent value="meta" className="mt-0 space-y-3 p-1">
                {previewPage && [
                  { label: "Slug", value: previewPage.slug },
                  { label: "Title", value: previewPage.title },
                  { label: "H1", value: previewPage.h1 },
                  { label: "Meta Description", value: previewPage.metaDescription },
                  { label: "Canonical URL", value: previewPage.canonicalUrl },
                  { label: "Page Type", value: previewPage.pageType },
                  { label: "Word Count", value: String(previewPage.wordCount) },
                  { label: "Publish Score", value: previewPage.publishScore },
                  { label: "Local Signal", value: previewPage.localSignalScore },
                ].map(({ label, value }) => (
                  <div key={label} className="grid grid-cols-3 gap-2 border-b pb-2">
                    <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    <span className="col-span-2 text-sm break-all">{value || "—"}</span>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="qa" className="mt-0 p-1">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {previewPage?.passedQa ? (
                      <Badge className="bg-emerald-100 text-emerald-700">QA Passed</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700">QA Failed</Badge>
                    )}
                  </div>
                  {previewPage?.qaReport?.issues?.length > 0 && (
                    <ul className="space-y-1 mt-3">
                      {previewPage.qaReport.issues.map((issue: string, i: number) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <X className="size-3.5 text-destructive shrink-0 mt-0.5" />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700"
              onClick={() => { approve.mutate(previewPage.id); setPreviewPage(null); }}>
              <Check className="size-4 mr-1" />Approve
            </Button>
            <Button variant="outline" size="sm" className="border-red-200 text-red-700"
              onClick={() => { prune.mutate(previewPage.id); setPreviewPage(null); }}>
              <X className="size-4 mr-1" />Prune
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
