import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ExternalLink, Eye, Trash2, RefreshCw, Globe, Copy, Info, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";

const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;

export default function PublishedPagesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [overrideWebsite, setOverrideWebsite] = useState(params.get("websiteId") || "");
  const [searchText, setSearchText] = useState("");
  const [showDns, setShowDns] = useState(false);
  const [editSlugPage, setEditSlugPage] = useState<any>(null);
  const [slugInput, setSlugInput] = useState("");
  const [slugError, setSlugError] = useState("");

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const selectedWebsite = overrideWebsite || (websites as any[])[0]?.id || "";

  const { data: pagesData, isLoading } = useQuery({
    queryKey: ["/api/pages/published", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=published&limit=200`) : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const { data: reviewData } = useQuery({
    queryKey: ["/api/pages/review", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=review&limit=1`) : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const publishAll = useMutation({
    mutationFn: () => api.post<any>(`/api/websites/${selectedWebsite}/pages/publish-all`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pages/published"] });
      qc.invalidateQueries({ queryKey: ["/api/pages/review"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `Published ${data.published} pages` });
    },
  });

  const prune = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/prune`, { reason: "Manually pruned from published view" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/published"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page pruned" });
    },
  });

  const slugMut = useMutation({
    mutationFn: ({ id, slug }: { id: string; slug: string }) =>
      api.put(`/api/pages/${id}/slug`, { slug }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/published", selectedWebsite] });
      setEditSlugPage(null);
      setSlugInput("");
      setSlugError("");
      toast({ title: "Slug updated" });
    },
    onError: (err: any) => setSlugError(err.message ?? "Failed to update slug"),
  });

  const openSlugEdit = (page: any) => {
    setEditSlugPage(page);
    setSlugInput(page.slug);
    setSlugError("");
  };

  const validateAndSaveSlug = () => {
    const trimmed = slugInput.trim();
    if (!trimmed) { setSlugError("Slug cannot be empty."); return; }
    if (!SLUG_RE.test(trimmed)) {
      setSlugError("Slug must be lowercase letters and hyphens only — no numbers, spaces, or special characters.");
      return;
    }
    if (trimmed === editSlugPage.slug) { setEditSlugPage(null); return; }
    slugMut.mutate({ id: editSlugPage.id, slug: trimmed });
  };

  const currentWebsite = websites.find((w: any) => w.id === selectedWebsite);
  const pages = (pagesData?.pages || []).filter((p: any) =>
    !searchText || p.title.toLowerCase().includes(searchText.toLowerCase()) || p.slug.includes(searchText.toLowerCase())
  );

  const platformBase = window.location.origin;
  const pageUrl = (page: any) =>
    currentWebsite ? `https://${currentWebsite.domain}/${page.slug}` : null;

  const copyUrl = (page: any) => {
    const url = pageUrl(page);
    if (url) { navigator.clipboard.writeText(url); toast({ title: "URL copied" }); }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Published Pages</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {pagesData?.total ? `${pagesData.total} pages live` : "Manage live published pages."}
              {reviewData?.total > 0 && (
                <span className="ml-2 text-amber-600 font-medium">{reviewData.total} awaiting publish</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {reviewData?.total > 0 && selectedWebsite && (
              <Button
                size="sm"
                onClick={() => publishAll.mutate()}
                disabled={publishAll.isPending}
                data-testid="button-publish-all"
              >
                <Globe className="size-4 mr-2" />
                {publishAll.isPending ? "Publishing…" : `Publish All (${reviewData.total})`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/pages/published"] })}>
              <RefreshCw className="size-4 mr-2" />Refresh
            </Button>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden text-sm">
          <div className="flex items-start justify-between gap-3 p-3">
            <div className="flex items-start gap-2 text-blue-800">
              <Info className="size-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">How pages are served: </span>
                {currentWebsite ? (
                  <>
                    Pages for <strong>{currentWebsite.domain}</strong> are live at{" "}
                    <button
                      className="font-mono bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded text-xs transition-colors inline-flex items-center gap-1"
                      onClick={() => { navigator.clipboard.writeText(`https://${currentWebsite.domain}/`); toast({ title: "Base URL copied" }); }}
                    >
                      https://{currentWebsite.domain}/…
                      <Copy className="size-3" />
                    </button>
                    {" "}— use <Eye className="size-3 inline" /> to preview via this platform, <ExternalLink className="size-3 inline" /> for the live customer URL.
                  </>
                ) : (
                  <>
                    Pages are served at{" "}
                    <code className="bg-blue-100 px-1 rounded text-xs">{platformBase}/sites/yourdomain.com/slug</code>
                  </>
                )}
              </div>
            </div>
            <button
              className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs whitespace-nowrap shrink-0"
              onClick={() => setShowDns(!showDns)}
            >
              {showDns ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              Own domain setup
            </button>
          </div>
          {showDns && (
            <div className="border-t border-blue-200 bg-blue-100/50 px-4 py-3 space-y-2 text-blue-900">
              <p className="font-medium text-xs">To serve pages on your client's own domain, add this DNS record at their registrar or Cloudflare:</p>
              <div className="font-mono text-xs bg-white border border-blue-200 rounded p-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <span className="text-blue-400">Type</span><span>CNAME</span>
                <span className="text-blue-400">Name</span>
                <span>{currentWebsite?.domain || "subdomain.clientdomain.com"}</span>
                <span className="text-blue-400">Value</span>
                <button
                  className="text-left hover:underline flex items-center gap-1"
                  onClick={() => { navigator.clipboard.writeText(platformBase.replace(/^https?:\/\//,"")); toast({ title: "CNAME value copied" }); }}
                >
                  {platformBase.replace(/^https?:\/\//,"")}
                  <Copy className="size-3 text-blue-400" />
                </button>
                <span className="text-blue-400">TTL</span><span>300</span>
              </div>
              <p className="text-xs text-blue-700">Once the CNAME propagates (5–30 min), the client's domain will route to this platform and serve pages automatically. No code changes needed.</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border flex-wrap">
          <Select onValueChange={setOverrideWebsite} value={selectedWebsite}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select website" />
            </SelectTrigger>
            <SelectContent>
              {websites.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search pages..." className="pl-9 h-9" value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>
        </div>

        {!selectedWebsite ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Globe className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select a website to view published pages</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title / Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Words</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : pages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No published pages yet.
                    </TableCell>
                  </TableRow>
                ) : pages.map((page: any) => (
                  <TableRow key={page.id}>
                    <TableCell>
                      <div className="font-medium text-sm truncate max-w-[280px]">{page.title}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[260px] flex items-center gap-1.5 mt-0.5">
                        <span className="truncate">/{page.slug}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => copyUrl(page)} title="Copy URL" className="hover:text-primary">
                            <Copy className="size-3" />
                          </button>
                          {currentWebsite && (
                            <a
                              href={`${platformBase}/sites/${currentWebsite.domain}/${page.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Preview page (platform)"
                              className="hover:text-primary"
                            >
                              <Eye className="size-3" />
                            </a>
                          )}
                          {pageUrl(page) && (
                            <a href={pageUrl(page)!} target="_blank" rel="noopener noreferrer" title="Open live customer URL">
                              <ExternalLink className="size-3 hover:text-primary" />
                            </a>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {page.pageType?.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-medium ${parseFloat(page.publishScore) >= 0.7 ? "text-emerald-600" : "text-amber-600"}`}>
                        {(parseFloat(page.publishScore) * 100).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">{page.wordCount?.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {page.publishedAt ? formatDistanceToNow(new Date(page.publishedAt)) + " ago" : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-foreground"
                          onClick={() => openSlugEdit(page)}
                          title="Edit slug"
                          data-testid={`button-edit-slug-${page.id}`}
                        >
                          <Pencil className="size-3.5 mr-1" />Slug
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => confirm("Prune this page?") && prune.mutate(page.id)}
                          data-testid={`button-prune-${page.id}`}
                        >
                          <Trash2 className="size-3.5 mr-1" />Prune
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Edit Slug Dialog */}
      <Dialog open={!!editSlugPage} onOpenChange={open => { if (!open) { setEditSlugPage(null); setSlugInput(""); setSlugError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Slug</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-sm">/</span>
                <Input
                  value={slugInput}
                  onChange={e => { setSlugInput(e.target.value); setSlugError(""); }}
                  onKeyDown={e => e.key === "Enter" && validateAndSaveSlug()}
                  placeholder="my-page-slug"
                  className="font-mono text-sm"
                  data-testid="input-slug-edit"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">Lowercase letters and hyphens only. No numbers, spaces, or special characters.</p>
              {slugError && (
                <p className="text-xs text-destructive font-medium" data-testid="text-slug-error">{slugError}</p>
              )}
            </div>
            {editSlugPage && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium">Current:</span>{" "}
                <span className="font-mono">/{editSlugPage.slug}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditSlugPage(null); setSlugInput(""); setSlugError(""); }}>
              Cancel
            </Button>
            <Button
              onClick={validateAndSaveSlug}
              disabled={slugMut.isPending}
              data-testid="button-save-slug"
            >
              {slugMut.isPending ? "Saving…" : "Save Slug"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
