import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ExternalLink, Trash2, RefreshCw, Globe, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";

export default function PublishedPagesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [selectedWebsite, setSelectedWebsite] = useState(params.get("websiteId") || "");
  const [searchText, setSearchText] = useState("");

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: pagesData, isLoading } = useQuery({
    queryKey: ["/api/pages/published", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages?status=published&limit=200`) : Promise.resolve({ pages: [], total: 0 }),
    enabled: !!selectedWebsite,
  });

  const prune = useMutation({
    mutationFn: (id: string) => api.post(`/api/pages/${id}/prune`, { reason: "Manually pruned from published view" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pages/published"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Page pruned" });
    },
  });

  const currentWebsite = websites.find((w: any) => w.id === selectedWebsite);
  const pages = (pagesData?.pages || []).filter((p: any) =>
    !searchText || p.title.toLowerCase().includes(searchText.toLowerCase()) || p.slug.includes(searchText.toLowerCase())
  );

  const platformBase = window.location.origin;
  const pageUrl = (page: any) =>
    currentWebsite ? `${platformBase}/sites/${currentWebsite.domain}/${page.slug}` : null;

  const copyUrl = (page: any) => {
    const url = pageUrl(page);
    if (url) { navigator.clipboard.writeText(url); toast({ title: "URL copied" }); }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Published Pages</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {pagesData?.total ? `${pagesData.total} pages published` : "Manage live published pages."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/pages/published"] })}>
            <RefreshCw className="size-4 mr-2" />Refresh
          </Button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <strong>How publishing works:</strong> Pages are served live at{" "}
          <code className="bg-blue-100 px-1 rounded text-xs">{platformBase}/sites/yourdomain.com/slug</code>.
          To serve them on <strong>your own domain</strong>, point a subdomain (e.g. <code className="bg-blue-100 px-1 rounded text-xs">local.spotonresults.com</code>) to this app, or configure Cloudflare R2.
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border flex-wrap">
          <Select onValueChange={setSelectedWebsite} value={selectedWebsite}>
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
                  <TableHead className="w-[100px]"></TableHead>
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
                          {pageUrl(page) && (
                            <a href={pageUrl(page)!} target="_blank" rel="noopener noreferrer" title="Open page">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => confirm("Prune this page?") && prune.mutate(page.id)}
                      >
                        <Trash2 className="size-3.5 mr-1" />Prune
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
