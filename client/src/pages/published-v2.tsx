import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Filter, RefreshCw, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type PageRow = {
  id: string;
  pageType: string;
  slug: string;
  title: string;
  status: string;
  wordCount?: number | null;
  tier?: number | null;
  qualityScore?: number | null;
  trustScore?: number | null;
  evidenceScore?: number | null;
  contentQualityScore?: number | null;
  publishedAt?: string | null;
  serviceName?: string | null;
  locationName?: string | null;
  locationState?: string | null;
};

const PAGE_TYPES = [
  ["state_hub", "State Hub"],
  ["city_hub", "City Hub"],
  ["service_city", "Service + City"],
  ["industry_city", "Industry + City"],
  ["problem_intent", "Problem Intent"],
];

function hostOnly(value: any) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
}

function liveBaseForWebsite(w: any) {
  const parent = hostOnly(w?.settings?.parentDomain || w?.settings?.publicDomain || w?.domain);
  const proxy = String(w?.settings?.proxyPath || "");
  return parent ? `https://${parent}${proxy}` : "";
}

function scoreClass(n?: number | null) {
  if (n == null) return "text-muted-foreground";
  if (n >= 80) return "text-emerald-600";
  if (n >= 60) return "text-amber-600";
  return "text-red-600";
}

function tierBadge(tier?: number | null) {
  if (tier === 1) return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">T1 ★</Badge>;
  if (tier === 2) return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">T2</Badge>;
  if (tier === 3) return <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-300">T3</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function MobilePageCard({ page, liveBase, onCopyUrl }: { page: PageRow; liveBase: string; onCopyUrl: (slug: string) => void }) {
  const liveUrl = liveBase ? `${liveBase}/${page.slug}` : "";

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium leading-snug break-words">{page.title}</h3>
            <p className="font-mono text-xs text-muted-foreground break-all">/{page.slug}</p>
          </div>
          <div className="shrink-0">{tierBadge(page.tier)}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Badge variant="outline" className="capitalize">{(page.pageType || "").replace(/_/g, " ")}</Badge>
          <span className="text-xs text-muted-foreground">{page.publishedAt ? `${formatDistanceToNow(new Date(page.publishedAt))} ago` : "Not dated"}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Quality</div>
          <div className={`font-semibold ${scoreClass(page.qualityScore)}`}>{page.qualityScore ?? "—"}</div>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trust</div>
          <div className={`font-semibold ${scoreClass(page.trustScore)}`}>{page.trustScore ?? "—"}</div>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Evidence</div>
          <div className={`font-semibold ${scoreClass(page.evidenceScore)}`}>{page.evidenceScore ?? "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground">Words</div>
          <div className="font-medium">{page.wordCount?.toLocaleString() || "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Status</div>
          <div className="font-medium capitalize">{page.status || "—"}</div>
        </div>
        <div className="col-span-2">
          <div className="text-muted-foreground">Service</div>
          <div className="font-medium break-words">{page.serviceName || "—"}</div>
        </div>
        <div className="col-span-2">
          <div className="text-muted-foreground">Location</div>
          <div className="font-medium break-words">{page.locationName ? `${page.locationName}${page.locationState ? `, ${page.locationState}` : ""}` : "—"}</div>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onCopyUrl(page.slug)}>
          <Copy className="size-3.5 mr-2" />Copy
        </Button>
        {liveUrl && (
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <a target="_blank" rel="noreferrer" href={liveUrl}><ExternalLink className="size-3.5 mr-2" />Open</a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function PublishedPagesV2() {
  const { toast } = useToast();
  const [websiteId, setWebsiteId] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("published");
  const [pageType, setPageType] = useState("all");
  const [tier, setTier] = useState("all");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [wordsMin, setWordsMin] = useState("");
  const [wordsMax, setWordsMax] = useState("");
  const [service, setService] = useState("");
  const [location, setLocation] = useState("");
  const [eeat, setEeat] = useState("all");
  const [indexed, setIndexed] = useState("all");
  const [sort, setSort] = useState("newest");
  const [limit, setLimit] = useState("50");
  const [page, setPage] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // --- Delete All state ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<string | null>(null);

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const selectedWebsite = websiteId || (websites as any[])[0]?.id || "";
  const currentWebsite = (websites as any[]).find((w: any) => w.id === selectedWebsite);
  const liveBase = liveBaseForWebsite(currentWebsite);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", limit);
    p.set("sort", sort);
    if (q.trim()) p.set("q", q.trim());
    if (status !== "all") p.set("status", status);
    if (pageType !== "all") p.set("pageType", pageType);
    if (tier !== "all") p.set("tier", tier);
    if (scoreMin) p.set("scoreMin", scoreMin);
    if (scoreMax) p.set("scoreMax", scoreMax);
    if (wordsMin) p.set("wordsMin", wordsMin);
    if (wordsMax) p.set("wordsMax", wordsMax);
    if (service.trim()) p.set("service", service.trim());
    if (location.trim()) p.set("location", location.trim());
    if (eeat !== "all") p.set("eeat", eeat);
    if (indexed !== "all") p.set("indexed", indexed);
    return p.toString();
  }, [page, limit, sort, q, status, pageType, tier, scoreMin, scoreMax, wordsMin, wordsMax, service, location, eeat, indexed]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["/api/pages/search-v2", selectedWebsite, queryString],
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages/search?${queryString}`) : Promise.resolve({ pages: [], total: 0, totalPages: 0, facets: {} }),
    enabled: !!selectedWebsite,
  });

  const pages: PageRow[] = data?.pages || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const facets = data?.facets || {};

  const resetFilters = () => {
    setQ(""); setStatus("published"); setPageType("all"); setTier("all"); setScoreMin(""); setScoreMax(""); setWordsMin(""); setWordsMax(""); setService(""); setLocation(""); setEeat("all"); setIndexed("all"); setSort("newest"); setPage(1);
  };

  const preset = (name: string) => {
    setPage(1);
    if (name === "tier1") { setStatus("published"); setTier("1"); setEeat("all"); setWordsMin(""); setWordsMax(""); setScoreMin(""); setScoreMax(""); }
    if (name === "weak") { setStatus("published"); setTier("all"); setEeat("weak"); setWordsMin(""); setWordsMax(""); setScoreMin(""); setScoreMax(""); }
    if (name === "missing") { setStatus("published"); setTier("all"); setEeat("missing"); setWordsMin(""); setWordsMax(""); setScoreMin(""); setScoreMax(""); }
    if (name === "thin") { setStatus("published"); setTier("all"); setEeat("all"); setWordsMin(""); setWordsMax("699"); setScoreMin(""); setScoreMax(""); }
    if (name === "money") { setStatus("published"); setTier("1"); setEeat("strong"); setWordsMin("1000"); setWordsMax(""); setScoreMin("80"); setScoreMax(""); }
  };

  const copyUrl = (slug: string) => {
    const url = `${liveBase}/${slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: "URL copied" });
  };

  // --- Delete All Published Pages handler ---
  const handleDeleteAll = async () => {
    if (!selectedWebsite) return;
    setIsDeleting(true);
    setDeleteProgress("Deleting pages…");
    let totalDeleted = 0;
    let batches = 0;
    try {
      let hasMore = true;
      while (hasMore) {
        batches++;
        const res = await fetch(`/api/websites/${selectedWebsite}/pages/purge`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || `Request failed (${res.status})`);
        }
        const json = await res.json();
        totalDeleted += json.deletedThisBatch ?? 0;
        hasMore = json.hasMore ?? false;
        if (hasMore) {
          setDeleteProgress(`Deleted ${totalDeleted.toLocaleString()} records so far (batch ${batches})…`);
        }
      }
      setShowDeleteConfirm(false);
      toast({
        title: "All published pages deleted",
        description: `${totalDeleted.toLocaleString()} records removed across ${batches} batch${batches === 1 ? "" : "es"}.`,
      });
      refetch();
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err?.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Published Pages</h1>
            <p className="text-sm text-muted-foreground">Server-side search across {Number(facets.all_count || total || 0).toLocaleString()} pages.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!selectedWebsite || isDeleting || isFetching}
            >
              <Trash2 className="size-4 mr-2" />
              {isDeleting ? (deleteProgress ?? "Deleting…") : "Delete All Published Pages"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
          <Button variant="outline" className="justify-between" onClick={() => preset("tier1")}>Tier 1 <Badge variant="secondary">{facets.tier1_count ?? "—"}</Badge></Button>
          <Button variant="outline" className="justify-between" onClick={() => preset("weak")}>Weak E-E-A-T <Badge variant="secondary">{facets.missing_eeat_count ?? "—"}</Badge></Button>
          <Button variant="outline" className="justify-between" onClick={() => preset("missing")}>Missing Scores <Badge variant="secondary">{facets.missing_eeat_count ?? "—"}</Badge></Button>
          <Button variant="outline" className="justify-between" onClick={() => preset("thin")}>Thin Pages <Badge variant="secondary">{facets.thin_count ?? "—"}</Badge></Button>
          <Button variant="outline" className="justify-between" onClick={() => preset("money")}>Money Pages <Badge variant="secondary">T1</Badge></Button>
        </div>

        <div className="rounded-lg border bg-card p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[16rem_1fr_9rem_7rem_auto_auto] gap-3 items-center">
            <Select value={selectedWebsite} onValueChange={(v) => { setWebsiteId(v); setPage(1); }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select website" /></SelectTrigger>
              <SelectContent>{(websites as any[]).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain || w.domain}</SelectItem>)}</SelectContent>
            </Select>

            <div className="relative min-w-0">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9 w-full" placeholder="Search title, slug, H1, meta..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>

            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="drafts">Drafts</SelectItem>
                <SelectItem value="all">All Status</SelectItem>
              </SelectContent>
            </Select>

            <Select value={tier} onValueChange={(v) => { setTier(v); setPage(1); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="1">Tier 1</SelectItem>
                <SelectItem value="2">Tier 2</SelectItem>
                <SelectItem value="3">Tier 3</SelectItem>
              </SelectContent>
            </Select>

            <Button className="w-full xl:w-auto" variant={advancedOpen ? "secondary" : "outline"} onClick={() => setAdvancedOpen(!advancedOpen)}>
              <SlidersHorizontal className="size-4 mr-2" />Advanced
            </Button>
            <Button className="w-full xl:w-auto" variant="ghost" onClick={resetFilters}><X className="size-4 mr-2" />Clear</Button>
          </div>

          {advancedOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 border-t pt-3">
              <Select value={pageType} onValueChange={(v) => { setPageType(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Page Type" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Types</SelectItem>{PAGE_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={eeat} onValueChange={(v) => { setEeat(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="E-E-A-T" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All E-E-A-T</SelectItem><SelectItem value="missing">Missing Scores</SelectItem><SelectItem value="weak">Weak Scores</SelectItem><SelectItem value="strong">Strong Scores</SelectItem></SelectContent>
              </Select>
              <Select value={indexed} onValueChange={(v) => { setIndexed(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Google" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Google</SelectItem><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="not_submitted">Not Submitted</SelectItem></SelectContent>
              </Select>
              <Input placeholder="Service contains" value={service} onChange={(e) => { setService(e.target.value); setPage(1); }} />
              <Input placeholder="Location contains" value={location} onChange={(e) => { setLocation(e.target.value); setPage(1); }} />
              <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest Published</SelectItem>
                  <SelectItem value="updated">Recently Updated</SelectItem>
                  <SelectItem value="score">Score High → Low</SelectItem>
                  <SelectItem value="score_asc">Score Low → High</SelectItem>
                  <SelectItem value="words">Words High → Low</SelectItem>
                  <SelectItem value="words_asc">Words Low → High</SelectItem>
                  <SelectItem value="tier">Tier</SelectItem>
                  <SelectItem value="title">Title A-Z</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Score min" type="number" value={scoreMin} onChange={(e) => { setScoreMin(e.target.value); setPage(1); }} />
              <Input placeholder="Score max" type="number" value={scoreMax} onChange={(e) => { setScoreMax(e.target.value); setPage(1); }} />
              <Input placeholder="Words min" type="number" value={wordsMin} onChange={(e) => { setWordsMin(e.target.value); setPage(1); }} />
              <Input placeholder="Words max" type="number" value={wordsMax} onChange={(e) => { setWordsMax(e.target.value); setPage(1); }} />
              <Select value={limit} onValueChange={(v) => { setLimit(v); setPage(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="50">50 / page</SelectItem><SelectItem value="100">100 / page</SelectItem><SelectItem value="250">250 / page</SelectItem></SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-muted-foreground">
          <div>{total.toLocaleString()} result{total === 1 ? "" : "s"} · page {page.toLocaleString()} of {Math.max(totalPages, 1).toLocaleString()}</div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>

        <div className="md:hidden space-y-3">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
              <Skeleton className="h-9 w-full" />
            </div>
          )) : pages.length === 0 ? (
            <div className="rounded-lg border bg-card py-10 text-center text-muted-foreground">
              <Filter className="size-8 mx-auto mb-2 opacity-40" />No pages match these filters.
            </div>
          ) : pages.map((p) => <MobilePageCard key={p.id} page={p} liveBase={liveBase} onCopyUrl={copyUrl} />)}
        </div>

        <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title / Slug</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Q/T/E</TableHead>
                <TableHead className="text-right">Words</TableHead>
                <TableHead>Service / Location</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="w-[72px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              )) : pages.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground"><Filter className="size-8 mx-auto mb-2 opacity-40" />No pages match these filters.</TableCell></TableRow>
              ) : pages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium max-w-[420px] truncate">{p.title}</div>
                    <div className="font-mono text-xs text-muted-foreground truncate max-w-[420px]">/{p.slug}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{(p.pageType || "").replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell>{tierBadge(p.tier)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    <span className={scoreClass(p.qualityScore)}>{p.qualityScore ?? "—"}</span>
                    <span className="text-muted-foreground/50"> / </span>
                    <span className={scoreClass(p.trustScore)}>{p.trustScore ?? "—"}</span>
                    <span className="text-muted-foreground/50"> / </span>
                    <span className={scoreClass(p.evidenceScore)}>{p.evidenceScore ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-right">{p.wordCount?.toLocaleString() || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="max-w-[220px] truncate">{p.serviceName || "—"}</div>
                    <div className="max-w-[220px] truncate">{p.locationName ? `${p.locationName}${p.locationState ? `, ${p.locationState}` : ""}` : "—"}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.publishedAt ? `${formatDistanceToNow(new Date(p.publishedAt))} ago` : "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button className="p-1 hover:text-primary" title="Copy URL" onClick={() => copyUrl(p.slug)}><Copy className="size-3.5" /></button>
                      {liveBase && <a className="p-1 hover:text-primary" title="Open live URL" target="_blank" rel="noreferrer" href={`${liveBase}/${p.slug}`}><ExternalLink className="size-3.5" /></a>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Delete All Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={(open) => { if (!isDeleting) setShowDeleteConfirm(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all published pages?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>all {Number(facets.all_count || total || 0).toLocaleString()} pages</strong> for the selected website.
              Accounts, websites, services, locations, brand profiles, and blueprints are not affected.
              <br /><br />
              <strong className="text-destructive">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(e) => { e.preventDefault(); handleDeleteAll(); }}
            >
              {isDeleting ? (deleteProgress ?? "Deleting…") : "Yes, delete all pages"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
