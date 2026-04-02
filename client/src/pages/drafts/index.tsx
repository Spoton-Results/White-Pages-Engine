import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Eye, FileText, RefreshCw, AlertCircle, Globe, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function DraftsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideWebsite, setOverrideWebsite] = useState<string>("");
  const [previewPage, setPreviewPage] = useState<any>(null);
  const [previewContent, setPreviewContent] = useState<any>(null);

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const selectedWebsite = overrideWebsite || (websites as any[])[0]?.id || "";

  const { data: pagesData, isLoading, isFetching: draftsFetching } = useQuery({
    queryKey: ["/api/pages/draft", selectedWebsite],
    queryFn: () => selectedWebsite
      ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=draft`)
      : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/draft"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page published" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const prune = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/prune`, { reason: "Pruned from draft review" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/draft"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page pruned" });
    },
  });

  const publishAll = useMutation({
    mutationFn: () => api.post<{ published: number }>(`/api/websites/${selectedWebsite}/pages/publish-all`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pages/draft"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `Published ${data.published} pages` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pruneAll = useMutation({
    mutationFn: () => api.post<{ pruned: number }>(`/api/websites/${selectedWebsite}/pages/prune-all-drafts`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pages/draft"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `Pruned ${data.pruned} draft pages` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
            <p className="text-muted-foreground text-sm mt-0.5">
              Pages that failed QA — review and publish or prune them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pages.length > 0 && (
              <>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => publishAll.mutate()}
                  disabled={publishAll.isPending}
                  data-testid="button-publish-all"
                >
                  <Globe className="size-4 mr-2" />
                  {publishAll.isPending ? "Publishing…" : `Publish All (${pages.length})`}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" data-testid="button-prune-all">
                      <Trash2 className="size-4 mr-2" />Prune All ({pages.length})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Prune all {pages.length} draft pages?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently mark all draft pages as pruned. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => pruneAll.mutate()}
                      >
                        Prune All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => qc.refetchQueries({ queryKey: ["/api/pages/draft", selectedWebsite] })} disabled={draftsFetching}>
              <RefreshCw className={`size-4 mr-2 ${draftsFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setOverrideWebsite} value={selectedWebsite}>
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
              <h3 className="font-semibold">No drafts to review</h3>
              <p className="text-muted-foreground text-sm mt-1">
                All pages with QA issues have been handled. Run a generation job to create new pages.
              </p>
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
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs shrink-0">
                        <AlertCircle className="size-3 mr-1" />Failed QA
                      </Badge>
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
                      onClick={() => publish.mutate(page.id)} disabled={publish.isPending}
                      data-testid={`button-publish-${page.id}`}>
                      <Globe className="size-4 mr-1" />Publish
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => prune.mutate(page.id)} disabled={prune.isPending}
                      data-testid={`button-prune-${page.id}`}>
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
              onClick={() => { publish.mutate(previewPage.id); setPreviewPage(null); }}>
              <Globe className="size-4 mr-1" />Publish
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
