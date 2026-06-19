import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ExternalLink, Eye, Trash2, RefreshCw, Globe, Copy, Info, ChevronDown, ChevronUp, Pencil, Layers, Send, Filter, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useAccountContext } from "@/hooks/use-account-context";

const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;

export default function PublishedPagesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { selectedAccountId } = useAccountContext();
  // ✅ CHANGED: capture the URL param once so we can use it to seed the override and fetch the website
  const urlWebsiteId = params.get("websiteId") || "";
  const [overrideWebsite, setOverrideWebsite] = useState(urlWebsiteId);
  const [searchText, setSearchText] = useState("");
  const [showDns, setShowDns] = useState(false);
  const [editSlugPage, setEditSlugPage] = useState<any>(null);
  const [slugInput, setSlugInput] = useState("");
  const [slugError, setSlugError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [scoreMinFilter, setScoreMinFilter] = useState("");
  const [scoreMaxFilter, setScoreMaxFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showBulkTier, setShowBulkTier] = useState(false);
  const [tierFilters, setTierFilters] = useState<{ serviceId: string; locationName: string; blueprintId: string; scoreMin: string; scoreMax: string }>({ serviceId: "", locationName: "", blueprintId: "", scoreMin: "", scoreMax: "" });
  const [tierTarget, setTierTarget] = useState("1");
  const [tierPreview, setTierPreview] = useState<{ count: number } | null>(null);
  const [tierPreviewing, setTierPreviewing] = useState(false);
  const [tierSaving, setTierSaving] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [eeaRescoring, setEeaRescoring] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ tier: number; minScore: number | null; maxScore: number | null; reason: string } | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [sortFilter, setSortFilter] = useState("slug");
  const [serviceFilter, setServiceFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [savedFilters, setSavedFilters] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem("publishedPageFilters") || "[]"); }
    catch { return []; }
  });
  const [groupBy, setGroupBy] = useState("none");
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());

  // Build the websites query URL — scope by account when one is selected
  const websitesUrl = selectedAccountId
    ? `/api/accounts/${selectedAccountId}/websites`
    : "/api/websites";

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites", selectedAccountId],
    queryFn: () => api.get<any[]>(websitesUrl),
  });

  // ✅ CHANGED: when the page was opened with ?websiteId=<id>, fetch that specific
  // website directly so the Select always has a matching option — even when no
  // account is selected in the global top bar and the websites list is empty or
  // doesn't include this website.
  const { data: urlWebsite } = useQuery({
    queryKey: ["/api/websites", urlWebsiteId],
    queryFn: () => api.get<any>(`/api/websites/${urlWebsiteId}`),
    enabled: !!urlWebsiteId,
  });

  // ✅ CHANGED: merge the URL-param website into the list so the Select always
  // has a matching option for the current value of overrideWebsite.
  const websitesList = urlWebsite
    ? (websites as any[]).some((w: any) => w.id === urlWebsite.id)
      ? (websites as any[])
      : [urlWebsite, ...(websites as any[])]
    : (websites as any[]);

  // ✅ CHANGED: auto-select the first website when the list loads and no override is set
  useEffect(() => {
    if (!overrideWebsite && websitesList.length > 0) {
      setOverrideWebsite(websitesList[0].id);
    }
  }, [websitesList.length, overrideWebsite]);

  // 🔒 UNTOUCHED: fallback still in place for the first render before effect fires
  const selectedWebsite = overrideWebsite || websitesList[0]?.id || "";

  const { data: pagesData, isLoading, isFetching: pagesFetching } = useQuery({
    queryKey: ["/api/pages/published", selectedWebsite, showDrafts, searchText, typeFilter, tierFilter, scoreMinFilter, scoreMaxFilter, sortFilter, serviceFilter, locationFilter, pageNumber],
    queryFn: () => {
      if (!selectedWebsite) return Promise.resolve({ pages: [], total: 0 });
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("page", String(pageNumber));
      params.set("sort", sortFilter || "slug");
      if (showDrafts) params.set("includeDrafts", "true");
      else params.set("status", "published");
      if (searchText.trim()) params.set("q", searchText.trim());
      if (typeFilter) params.set("pageType", typeFilter);
      if (tierFilter) params.set("tier", tierFilter);
      if (scoreMinFilter) params.set("scoreMin", scoreMinFilter);
      if (scoreMaxFilter) params.set("scoreMax", scoreMaxFilter);
      if (serviceFilter.trim()) params.set("service", serviceFilter.trim());
      if (locationFilter.trim()) params.set("location", locationFilter.trim());
      return api.get<any>(`/api/websites/${selectedWebsite}/pages/search?${params.toString()}`);
    },
    enabled: !!selectedWebsite,
  });

  const { data: reviewData } = useQuery({
    queryKey: ["/api/pages/review", selectedWebsite],
    // ✅ CHANGED: use /pages/search (raw SQL route) instead of /pages (broken Drizzle route)
    queryFn: () => selectedWebsite ? api.get<any>(`/api/websites/${selectedWebsite}/pages/search?status=review&limit=1`) : Promise.resolve({ pages: [], total: 0 }),
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

  // ✅ CHANGED: use websitesList (merged list) instead of websites for currentWebsite lookup
  const currentWebsite = websitesList.find((w: any) => w.id === selectedWebsite);
  const currentAccountId = currentWebsite?.accountId || "";

  const { data: tierServices = [] } = useQuery({
    queryKey: ["/api/accounts", currentAccountId, "services"],
    queryFn: () => api.get<any[]>(`/api/accounts/${currentAccountId}/services`),
    enabled: !!currentAccountId && showBulkTier,
  });
  const { data: tierBlueprints = [] } = useQuery({
    queryKey: ["/api/accounts", currentAccountId, "blueprints"],
    queryFn: () => api.get<any[]>(`/api/accounts/${currentAccountId}/blueprints`),
    enabled: !!currentAccountId && showBulkTier,
  });

  const previewTier = async () => {
    setTierPreviewing(true); setTierPreview(null);
    const p = new URLSearchParams();
    if (tierFilters.serviceId) p.set("serviceId", tierFilters.serviceId);
    if (tierFilters.locationName.trim()) p.set("locationName", tierFilters.locationName.trim());
    if (tierFilters.blueprintId) p.set("blueprintId", tierFilters.blueprintId);
    if (tierFilters.scoreMin) p.set("scoreMin", tierFilters.scoreMin);
    if (tierFilters.scoreMax) p.set("scoreMax", tierFilters.scoreMax);
    try {
      const result = await api.get<any>(`/api/websites/${selectedWebsite}/pages/bulk-tier-preview?${p.toString()}`);
      setTierPreview({ count: result.count });
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally { setTierPreviewing(false); }
  };

  const applyTier = async () => {
    setTierSaving(true);
    try {
      const result = await api.post<any>(`/api/websites/${selectedWebsite}/pages/bulk-set-tier`, {
        tier: parseInt(tierTarget),
        filters: {
          ...tierFilters,
          locationName: tierFilters.locationName.trim() || undefined,
          scoreMin: tierFilters.scoreMin !== "" ? Number(tierFilters.scoreMin) : undefined,
          scoreMax: tierFilters.scoreMax !== "" ? Number(tierFilters.scoreMax) : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: ["/api/pages/published", selectedWebsite] });
      toast({ title: `Set ${result.affected ?? result.updated} page(s) to Tier ${tierTarget}` });
      setShowBulkTier(false); setTierPreview(null); setTierFilters({ serviceId: "", locationName: "", blueprintId: "", scoreMin: "", scoreMax: "" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setTierSaving(false); }
  };

  const suggestTier = async () => {
    setAiSuggesting(true); setAiSuggestion(null);
    const selectedService = (tierServices as any[]).find((s: any) => s.id === tierFilters.serviceId);
    const selectedBlueprint = (tierBlueprints as any[]).find((b: any) => b.id === tierFilters.blueprintId);
    try {
      const result = await api.post<any>(`/api/websites/${selectedWebsite}/pages/bulk-tier-suggest`, {
        serviceName: selectedService?.name || "",
        locationName: tierFilters.locationName.trim(),
        blueprintName: selectedBlueprint?.name || "",
        currentTier: tierTarget,
        scoreMin: tierFilters.scoreMin,
        scoreMax: tierFilters.scoreMax,
      });
      setAiSuggestion(result);
    } catch (e: any) {
      toast({ title: "AI suggestion failed", description: e.message, variant: "destructive" });
    } finally { setAiSuggesting(false); }
  };

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setTierTarget(String(aiSuggestion.tier));
    setTierFilters(f => ({
      ...f,
      scoreMin: aiSuggestion.minScore != null ? String(aiSuggestion.minScore) : f.scoreMin,
      scoreMax: aiSuggestion.maxScore != null ? String(aiSuggestion.maxScore) : f.scoreMax,
    }));
  };

  const submitToGoogle = async () => {
    if (!confirm(`Submit all Tier 1 pages from this website to Google Indexing API?`)) return;
    setGoogleSubmitting(true);
    try {
      const result = await api.post<any>(`/api/websites/${selectedWebsite}/pages/submit-tier1-to-google`, {});
      toast({ title: `Submitted ${result.submitted}/${result.total} URLs to Google`, description: result.errors > 0 ? `${result.errors} error(s)` : undefined });
    } catch (e: any) {
      toast({ title: "Submission failed", description: e.message, variant: "destructive" });
    } finally { setGoogleSubmitting(false); }
  };

  const rescoreEEAT = async () => {
    if (!selectedWebsite) return;
    setEeaRescoring(true);
    try {
      await api.post<any>(`/api/websites/${selectedWebsite}/eeat-rescore`, { batchSize: 500 });
      toast({ title: "E-E-A-T rescore started", description: "Trust, Evidence, and Quality scores are being updated in the background. Refresh in ~30 seconds." });
    } catch (e: any) {
      toast({ title: "Rescore failed", description: e.message, variant: "destructive" });
    } finally { setEeaRescoring(false); }
  };

  const eeaScoreColor = (n: number | null | undefined) =>
    n == null ? "text-muted-foreground" :
    n >= 70 ? "text-emerald-600" :
    n >= 50 ? "text-amber-600" : "text-red-500";

  const activeFilterCount = [searchText, typeFilter, scoreMinFilter, scoreMaxFilter, tierFilter, serviceFilter, locationFilter].filter(Boolean).length;

  const resetPage = () => setPageNumber(1);
  const saveCurrentFilter = () => {
    const name = prompt("Preset name?");
    if (!name) return;
    const next = [{ name, searchText, typeFilter, tierFilter, scoreMinFilter, scoreMaxFilter, sortFilter, serviceFilter, locationFilter }, ...savedFilters].slice(0, 10);
    setSavedFilters(next);
    localStorage.setItem("publishedPageFilters", JSON.stringify(next));
    toast({ title: "Filter preset saved" });
  };
  const applySavedFilter = (preset: any) => {
    setSearchText(preset.searchText || "");
    setTypeFilter(preset.typeFilter || "");
    setTierFilter(preset.tierFilter || "");
    setScoreMinFilter(preset.scoreMinFilter || "");
    setScoreMaxFilter(preset.scoreMaxFilter || "");
    setSortFilter(preset.sortFilter || "slug");
    setServiceFilter(preset.serviceFilter || "");
    setLocationFilter(preset.locationFilter || "");
    setPageNumber(1);
  };
  const pages = pagesData?.pages || [];
  const selectedPages = pages.filter((page: any) => selectedPageIds.has(page.id));
  const allLoadedSelected = pages.length > 0 && pages.every((page: any) => selectedPageIds.has(page.id));

  const groupKeyForPage = (page: any) => {
    if (groupBy === "service") return page.serviceName || "No service";
    if (groupBy === "location") return page.locationName || page.locationState || "No location";
    if (groupBy === "pageType") return page.pageType?.replace(/_/g, " ") || "No page type";
    if (groupBy === "tier") return page.tier ? `Tier ${page.tier}` : "No tier";
    if (groupBy === "blueprint") return page.blueprintName || "No blueprint";
    return "";
  };

  const togglePageSelected = (id: string) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllLoaded = () => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      if (allLoadedSelected) pages.forEach((page: any) => next.delete(page.id));
      else pages.forEach((page: any) => next.add(page.id));
      return next;
    });
  };

  const exportSelectedCsv = () => {
    const rows = (selectedPages.length ? selectedPages : pages).map((page: any) => ({
      title: page.title || "",
      slug: page.slug || "",
      pageType: page.pageType || "",
      tier: page.tier ?? "",
      qualityScore: page.qualityScore ?? "",
      wordCount: page.wordCount ?? "",
      serviceName: page.serviceName || "",
      locationName: page.locationName || page.locationState || "",
      blueprintName: page.blueprintName || "",
      status: page.status || "",
    }));
    const header = Object.keys(rows[0] || { title: "", slug: "" });
    const csv = [
      header.join(","),
      ...rows.map((row: any) => header.map(k => `"${String(row[k] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "published-pages.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const quickFilter = (kind: string) => {
    setPageNumber(1);
    if (kind === "published") { setShowDrafts(false); return; }
    if (kind === "drafts") { setShowDrafts(true); return; }
    if (kind.startsWith("tier:")) { setTierFilter(kind.split(":")[1]); return; }
    if (kind.startsWith("type:")) { setTypeFilter(kind.split(":")[1]); return; }
    if (kind.startsWith("q:")) { setSearchText(kind.slice(2)); return; }
  };

  const knownPageTypes = [
    "service_location",
    "service_state",
    "city_service",
    "state_service",
    "industry_service",
    "service",
    "location",
    "hub",
    "landing",
    "blog",
    "case_study",
    "testimonial",
    "comparison",
    "faq",
  ];

  const pageTypes = Array.from(new Set([
    ...knownPageTypes,
    ...(pagesData?.pages || []).map((p: any) => p.pageType).filter(Boolean),
  ])) as string[];

  const platformBase = window.location.origin;
  const pageUrl = (page: any) => {
    if (!currentWebsite) return null;
    const pDomain = currentWebsite.settings?.parentDomain;
    const pPath = currentWebsite.settings?.proxyPath || "";
    if (pDomain) return `https://${pDomain}${pPath}/${page.slug}`;
    return `https://${currentWebsite.domain}/${page.slug}`;
  };

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
              {pagesData?.total ? `${pagesData.total} pages live` : "Server-side search across 0 pages."}
              {reviewData?.total > 0 && (
                <span className="ml-2 text-amber-600 font-medium">{reviewData.total} awaiting publish</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedWebsite && (
              <>
                <Button
                  variant={showDrafts ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowDrafts(!showDrafts)}
                  data-testid="button-toggle-drafts"
                  title="Show draft pages from onboarding generation alongside published pages"
                >
                  {showDrafts ? "Hide drafts" : "Show drafts"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowBulkTier(true)} data-testid="button-bulk-set-tier">
                  <Layers className="size-4 mr-2" />Bulk Set Tier
                </Button>
                <Button variant="outline" size="sm" onClick={rescoreEEAT} disabled={eeaRescoring} data-testid="button-eeat-rescore" title="Recompute Trust, Evidence & Quality scores for all pages">
                  <Zap className="size-4 mr-2" />{eeaRescoring ? "Rescoring…" : "E-E-A-T Rescore"}
                </Button>
                <Button variant="outline" size="sm" onClick={submitToGoogle} disabled={googleSubmitting} data-testid="button-submit-google">
                  <Send className="size-4 mr-2" />{googleSubmitting ? "Submitting…" : "Submit T1 to Google"}
                </Button>
              </>
            )}
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
            <Button variant="outline" size="sm" onClick={() => qc.refetchQueries({ queryKey: ["/api/pages/published", selectedWebsite] })} disabled={pagesFetching}>
              <RefreshCw className={`size-4 mr-2 ${pagesFetching ? "animate-spin" : ""}`} />Refresh
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
                    {(() => {
                      const pd = currentWebsite.settings?.parentDomain;
                      const pp = currentWebsite.settings?.proxyPath || "";
                      const liveBase = pd ? `https://${pd}${pp}` : `https://${currentWebsite.domain}`;
                      return (
                        <>
                          Pages for <strong>{pd || currentWebsite.domain}</strong> are live at{" "}
                          <button
                            className="font-mono bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded text-xs transition-colors inline-flex items-center gap-1"
                            onClick={() => { navigator.clipboard.writeText(`${liveBase}/`); toast({ title: "Base URL copied" }); }}
                          >
                            {liveBase}/…
                            <Copy className="size-3" />
                          </button>
                          {" "}— use <Eye className="size-3 inline" /> to preview via this platform, <ExternalLink className="size-3 inline" /> for the live customer URL.
                        </>
                      );
                    })()}
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

        <div className="flex flex-col gap-2 bg-card rounded-lg border overflow-hidden">
          <div className="flex items-center gap-3 p-3 flex-wrap">
            {/* 🔒 UNTOUCHED: Select UI is identical — only the data source (websitesList) changed */}
            <Select onValueChange={setOverrideWebsite} value={selectedWebsite}>
              <SelectTrigger className="w-52" data-testid="select-website">
                <SelectValue placeholder="Select website" />
              </SelectTrigger>
              <SelectContent>
                {websitesList.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain ? `${w.settings.parentDomain}${w.settings.proxyPath || ''}` : w.domain}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search title, slug, H1, meta..." className="pl-9 h-9" value={searchText} onChange={e => { setSearchText(e.target.value); resetPage(); }} data-testid="input-search-pages" />
            </div>
            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              className="h-9 gap-2"
              onClick={() => setShowFilters(f => !f)}
              data-testid="button-toggle-filters"
            >
              <Filter className="size-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground rounded-full text-xs w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
              )}
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={saveCurrentFilter} data-testid="button-save-filter-preset">
              Save Preset
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={exportSelectedCsv} data-testid="button-export-pages">
              Export CSV
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => { setSearchText(""); setTypeFilter(""); setScoreMinFilter(""); setScoreMaxFilter(""); setTierFilter(""); setServiceFilter(""); setLocationFilter(""); setPageNumber(1); }} data-testid="button-clear-filters">
                Clear
              </Button>
            )}
          </div>
          <div className="border-t px-3 py-2 flex items-center gap-2 flex-wrap bg-muted/20">
            {[
              ["Published", "published"],
              ["Drafts", "drafts"],
              ["Tier 1", "tier:1"],
              ["Tier 2", "tier:2"],
              ["Tier 3", "tier:3"],
              ["Case Studies", "q:case"],
              ["Testimonials", "q:testimonial"],
              ["Screenshots", "q:screenshot"],
              ["Videos", "q:video"],
            ].map(([label, value]) => (
              <Button key={value} variant="outline" size="sm" className="h-7 text-xs" onClick={() => quickFilter(value)}>
                {label}
              </Button>
            ))}
            {selectedPageIds.size > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {selectedPageIds.size.toLocaleString()} selected
              </span>
            )}
          </div>
          {showFilters && (
            <div className="border-t px-3 pb-3 pt-2.5 flex items-end gap-3 flex-wrap bg-muted/30">
              {savedFilters.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Saved Presets</Label>
                  <Select onValueChange={(v) => applySavedFilter(savedFilters[Number(v)])}>
                    <SelectTrigger className="h-8 text-xs w-44" data-testid="select-saved-filter">
                      <SelectValue placeholder="Load preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedFilters.map((preset, idx) => (
                        <SelectItem key={`${preset.name}-${idx}`} value={String(idx)}>{preset.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Service Contains</Label>
                <Input className="h-8 text-xs w-52" placeholder="e.g. retainage" value={serviceFilter} onChange={e => { setServiceFilter(e.target.value); resetPage(); }} data-testid="input-filter-service" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Location Contains</Label>
                <Input className="h-8 text-xs w-52" placeholder="state, city, slug..." value={locationFilter} onChange={e => { setLocationFilter(e.target.value); resetPage(); }} data-testid="input-filter-location" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Page Type</Label>
                <Select value={typeFilter || "all"} onValueChange={v => { setTypeFilter(v === "all" ? "" : v); resetPage(); }}>
                  <SelectTrigger className="h-8 text-xs w-44" data-testid="select-filter-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {pageTypes.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Tier</Label>
                <Select value={tierFilter || "all"} onValueChange={v => { setTierFilter(v === "all" ? "" : v); resetPage(); }}>
                  <SelectTrigger className="h-8 text-xs w-28" data-testid="select-filter-tier">
                    <SelectValue placeholder="All tiers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tiers</SelectItem>
                    <SelectItem value="1">Tier 1</SelectItem>
                    <SelectItem value="2">Tier 2</SelectItem>
                    <SelectItem value="3">Tier 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Sort</Label>
                <Select value={sortFilter} onValueChange={v => { setSortFilter(v); resetPage(); }}>
                  <SelectTrigger className="h-8 text-xs w-32" data-testid="select-sort-pages">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slug">Slug A-Z</SelectItem>
                    <SelectItem value="updated">Recently updated</SelectItem>
                    <SelectItem value="score">Score high</SelectItem>
                    <SelectItem value="score_asc">Score low</SelectItem>
                    <SelectItem value="words">Words high</SelectItem>
                    <SelectItem value="words_asc">Words low</SelectItem>
                    <SelectItem value="tier">Tier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Group By</Label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="h-8 text-xs w-36" data-testid="select-group-pages">
                    <SelectValue placeholder="Group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No grouping</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="location">Location</SelectItem>
                    <SelectItem value="pageType">Page Type</SelectItem>
                    <SelectItem value="tier">Tier</SelectItem>
                    <SelectItem value="blueprint">Blueprint</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Score Min (%)</Label>
                <Input className="h-8 text-xs w-24" placeholder="e.g. 70" value={scoreMinFilter} onChange={e => { setScoreMinFilter(e.target.value); resetPage(); }} type="number" min="0" max="100" data-testid="input-filter-score-min" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Score Max (%)</Label>
                <Input className="h-8 text-xs w-24" placeholder="e.g. 100" value={scoreMaxFilter} onChange={e => { setScoreMaxFilter(e.target.value); resetPage(); }} type="number" min="0" max="100" data-testid="input-filter-score-max" />
              </div>
              <p className="text-xs text-muted-foreground self-end pb-1">
                Showing {pages.length.toLocaleString()} of {(pagesData?.total || 0).toLocaleString()} matching pages
              </p>
            </div>
          )}
        </div>

        {!selectedWebsite ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Globe className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">
              {websitesList.length === 0
                ? "Select a client from the top bar to load websites"
                : "Select a website to view published pages"}
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" checked={allLoadedSelected} onChange={toggleAllLoaded} aria-label="Select loaded pages" />
                  </TableHead>
                  <TableHead>Title / Slug</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right" title="Quality · Trust · Evidence (0–100 each)">E-E-A-T</TableHead>
                  <TableHead className="text-right">Words</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : pages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No published pages yet.
                    </TableCell>
                  </TableRow>
                ) : pages.map((page: any, idx: number) => {
                  const group = groupKeyForPage(page);
                  const previousGroup = idx > 0 ? groupKeyForPage(pages[idx - 1]) : "";
                  const showGroup = groupBy !== "none" && group !== previousGroup;
                  return (
                  <Fragment key={page.id}>
                    {showGroup && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group}
                        </TableCell>
                      </TableRow>
                    )}
                  <TableRow data-testid={`row-page-${page.id}`}>
                    <TableCell>
                      <input type="checkbox" checked={selectedPageIds.has(page.id)} onChange={() => togglePageSelected(page.id)} aria-label={`Select ${page.title}`} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm truncate max-w-[280px] flex items-center gap-2">
                        <span className="truncate">{page.title}</span>
                        {page.isDraft && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-300 shrink-0" data-testid={`badge-draft-${page.id}`}>
                            DRAFT
                          </Badge>
                        )}
                      </div>
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
                    <TableCell>
                      {page.tier === 1 ? (
                        <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-100" variant="outline">T1 ★</Badge>
                      ) : page.tier === 2 ? (
                        <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-100" variant="outline">T2</Badge>
                      ) : page.tier === 3 ? (
                        <Badge className="text-[10px] bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-100" variant="outline">T3</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {page.qualityScore == null && page.trustScore == null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-mono" data-testid={`eeat-scores-${page.id}`}>
                          <span className="text-muted-foreground/60">Q</span>
                          <span className={`font-bold ${eeaScoreColor(page.qualityScore)}`} title="Quality Score">{page.qualityScore ?? "—"}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-muted-foreground/60">T</span>
                          <span className={`font-bold ${eeaScoreColor(page.trustScore)}`} title="Trust Score">{page.trustScore ?? "—"}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-muted-foreground/60">E</span>
                          <span className={`font-bold ${eeaScoreColor(page.evidenceScore)}`} title="Evidence Score">{page.evidenceScore ?? "—"}</span>
                        </div>
                      )}
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
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Page {pageNumber.toLocaleString()} of {(pagesData?.totalPages || 1).toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pageNumber <= 1 || pagesFetching} onClick={() => setPageNumber(p => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={pageNumber >= (pagesData?.totalPages || 1) || pagesFetching} onClick={() => setPageNumber(p => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Set Tier Dialog */}
      <Dialog open={showBulkTier} onOpenChange={v => { if (!v) { setShowBulkTier(false); setTierPreview(null); setAiSuggestion(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Filter className="size-4" />Bulk Set Page Tier</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">Filter published pages and assign a tier in bulk. Leave filters blank to match all pages.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Service</Label>
                <Select value={tierFilters.serviceId} onValueChange={v => setTierFilters(f => ({ ...f, serviceId: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any service" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any service</SelectItem>
                    {(tierServices as any[]).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Location</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Filter by city name…"
                  value={tierFilters.locationName}
                  onChange={e => setTierFilters(f => ({ ...f, locationName: e.target.value }))}
                  data-testid="input-tier-location-name"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Blueprint</Label>
                <Select value={tierFilters.blueprintId} onValueChange={v => setTierFilters(f => ({ ...f, blueprintId: v === "all" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any blueprint" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any blueprint</SelectItem>
                    {(tierBlueprints as any[]).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Tier to Set</Label>
                <Select value={tierTarget} onValueChange={setTierTarget}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 (Top Priority)</SelectItem>
                    <SelectItem value="2">Tier 2</SelectItem>
                    <SelectItem value="3">Tier 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Min Score (0–100)</Label>
                <Input type="number" min="0" max="100" className="h-8 text-xs" placeholder="e.g. 60"
                  value={tierFilters.scoreMin} onChange={e => setTierFilters(f => ({ ...f, scoreMin: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Max Score (0–100)</Label>
                <Input type="number" min="0" max="100" className="h-8 text-xs" placeholder="e.g. 90"
                  value={tierFilters.scoreMax} onChange={e => setTierFilters(f => ({ ...f, scoreMax: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={suggestTier}
                disabled={aiSuggesting}
                data-testid="btn-ai-suggest-tier"
                className="gap-2 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
              >
                {aiSuggesting ? (
                  <><span className="animate-spin inline-block size-3 border-2 border-violet-400 border-t-transparent rounded-full" />Thinking…</>
                ) : (
                  <><svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>AI Suggest</>
                )}
              </Button>
            </div>
            {aiSuggestion && (
              <div className="border border-violet-200 bg-violet-50/60 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-violet-800">AI Recommendation</span>
                  <span className="text-xs font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                    Tier {aiSuggestion.tier}
                    {aiSuggestion.minScore != null || aiSuggestion.maxScore != null
                      ? ` · Score ${aiSuggestion.minScore ?? ""}–${aiSuggestion.maxScore ?? ""}`
                      : ""}
                  </span>
                </div>
                <p className="text-xs text-violet-700 leading-snug">{aiSuggestion.reason}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start h-7 text-xs border-violet-300 text-violet-700 hover:bg-violet-100"
                  onClick={applyAiSuggestion}
                  data-testid="btn-apply-ai-suggestion"
                >
                  Apply These Settings
                </Button>
              </div>
            )}
            {tierPreview && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <strong>{tierPreview.count}</strong> page{tierPreview.count !== 1 ? "s" : ""} match your filters and will be set to Tier {tierTarget}.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={previewTier} disabled={tierPreviewing} data-testid="btn-tier-preview">
              {tierPreviewing ? "Previewing…" : "Preview Count"}
            </Button>
            <Button size="sm" onClick={applyTier} disabled={tierSaving || !tierPreview} data-testid="btn-tier-apply">
              {tierSaving ? "Applying…" : `Set Tier ${tierTarget}${tierPreview ? ` (${tierPreview.count})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
