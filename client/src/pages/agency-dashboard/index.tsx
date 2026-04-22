import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  PhoneCall, FileText, DollarSign, TrendingUp,
  CheckCircle, Loader2, CalendarDays, Pencil, Check,
  BarChart3, Globe, Zap, Target, ArrowUpRight,
  Link2, Link2Off, Copy, CheckCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ──────────────────────────────────────────────────────────────────

function monthOptions() {
  const opts: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    opts.push({ label, value });
  }
  return opts;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}

function fmtNum(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color, loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
          <Icon className={`size-4 ${color}`} />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24 mb-1" />
        ) : (
          <div className="text-3xl font-bold tracking-tight">{value}</div>
        )}
        {sub && !loading && (
          <div className="text-xs text-muted-foreground mt-1">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── ROI Metric Card ──────────────────────────────────────────────────────────

function RoiCard({
  label, value, sub, accent, loading,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  loading?: boolean;
}) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="p-5">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
        {loading ? (
          <Skeleton className="h-8 w-20 mb-1" />
        ) : (
          <div className="text-2xl font-bold tracking-tight">{value}</div>
        )}
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

// ── SEO Tier Bar ─────────────────────────────────────────────────────────────

function TierBar({ t1, t2, t3 }: { t1: number; t2: number; t3: number }) {
  const total = t1 + t2 + t3 || 1;
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
      {t1 > 0 && (
        <div
          className="bg-emerald-500 rounded-l-full"
          style={{ width: `${(t1 / total) * 100}%` }}
          title={`Tier 1: ${t1} pages`}
        />
      )}
      {t2 > 0 && (
        <div
          className="bg-blue-400"
          style={{ width: `${(t2 / total) * 100}%` }}
          title={`Tier 2: ${t2} pages`}
        />
      )}
      {t3 > 0 && (
        <div
          className="bg-gray-200 rounded-r-full"
          style={{ width: `${(t3 / total) * 100}%` }}
          title={`Tier 3: ${t3} pages`}
        />
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AgencyDashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const MONTHS = useMemo(() => monthOptions(), []);

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [month, setMonth] = useState<string>(currentMonth());
  const [bookDialog, setBookDialog] = useState<{ leadId: string; name: string } | null>(null);
  const [jobValue, setJobValue] = useState("");

  // Monthly spend inline edit
  const [spendEditing, setSpendEditing] = useState(false);
  const [spendInput, setSpendInput] = useState("");
  const spendInputRef = useRef<HTMLInputElement>(null);

  // GSC connect dialog
  const [gscDialog, setGscDialog] = useState(false);
  const [gscWebsiteId, setGscWebsiteId] = useState("");
  const [gscSiteUrlInput, setGscSiteUrlInput] = useState("");
  const [gscError, setGscError] = useState("");
  const [gscCopied, setGscCopied] = useState(false);

  // ── Accounts list (superAdmin only) ────────────────────────────────────────
  const { data: accounts } = useQuery<any[]>({
    queryKey: ["accounts-list"],
    queryFn: () => api.get<any[]>("/api/accounts"),
    enabled: !!user?.isSuperAdmin,
  });

  const accountId = user?.isSuperAdmin ? selectedAccountId : user?.accountId ?? "";

  useEffect(() => {
    if (user?.isSuperAdmin && accounts?.length && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, user?.isSuperAdmin, selectedAccountId]);

  // ── Dashboard summary (now includes SEO + ROI) ─────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["agency-dashboard", accountId, month],
    queryFn: () => api.get<any>(`/api/dashboard/agency/${accountId}?month=${month}`),
    enabled: !!accountId,
    staleTime: 60_000,
  });

  // Pre-fill spend input when summary loads
  useEffect(() => {
    if (summary?.roi?.monthlySpend != null && !spendEditing) {
      setSpendInput(String(summary.roi.monthlySpend));
    }
  }, [summary?.roi?.monthlySpend, spendEditing]);

  // ── Google Search Console service account email ─────────────────────────────
  const { data: saEmailData } = useQuery<{ email: string | null; configured: boolean }>({
    queryKey: ["gsc-sa-email"],
    queryFn: () => api.get("/api/gsc/sa-email"),
    enabled: !!accountId,
  });

  // ── Websites for the account ────────────────────────────────────────────────
  const { data: allWebsites } = useQuery<any[]>({
    queryKey: ["all-websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
    enabled: !!accountId,
  });

  const accountWebsites = useMemo(
    () => (allWebsites ?? []).filter((w: any) => w.accountId === accountId),
    [allWebsites, accountId],
  );

  // ── Form submissions (leads) — single account-level request, no per-website waterfall ──
  const { data: rawLeads, isLoading: leadsLoading } = useQuery<any[]>({
    queryKey: ["agency-leads", accountId, month],
    queryFn: async () => {
      if (!accountId) return [];
      const r = await api.get<any>(`/api/form-tracking/account-leads?accountId=${accountId}&month=${month}`);
      return r.leads ?? [];
    },
    enabled: !!accountId,
    staleTime: 60_000,
  });

  // ── Booked jobs ─────────────────────────────────────────────────────────────
  const { data: jobMetrics, isLoading: jobsLoading } = useQuery<any>({
    queryKey: ["booked-job-metrics", accountId, month],
    queryFn: () => api.get<any>(`/api/leads/metrics/${accountId}?month=${month}`),
    enabled: !!accountId,
    staleTime: 60_000,
  });

  // ── Update monthly spend ────────────────────────────────────────────────────
  const updateSpend = useMutation({
    mutationFn: (spend: number) =>
      api.patch<any>(`/api/accounts/${accountId}/spend`, { monthlySpend: spend }),
    onSuccess: () => {
      toast({ title: "Investment updated", description: "Monthly SEO investment saved." });
      qc.invalidateQueries({ queryKey: ["agency-dashboard", accountId, month] });
      setSpendEditing(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not save monthly investment.", variant: "destructive" });
    },
  });

  function saveSpend() {
    const v = parseFloat(spendInput);
    if (!isNaN(v) && v >= 0) updateSpend.mutate(v);
    else setSpendEditing(false);
  }

  // ── GSC connect mutation ────────────────────────────────────────────────────
  const gscConnect = useMutation({
    mutationFn: ({ websiteId, siteUrl }: { websiteId: string; siteUrl: string }) =>
      api.post<any>(`/api/websites/${websiteId}/gsc-connect`, { siteUrl }),
    onSuccess: () => {
      toast({ title: "Connected!", description: "Google Search Console connected. Real data will appear shortly." });
      qc.invalidateQueries({ queryKey: ["agency-dashboard", accountId, month] });
      setGscDialog(false);
      setGscError("");
    },
    onError: (err: any) => {
      setGscError(err.message ?? "Connection failed. Check the site URL and try again.");
    },
  });

  const gscDisconnect = useMutation({
    mutationFn: (websiteId: string) => api.delete<any>(`/api/websites/${websiteId}/gsc-connect`),
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Google Search Console has been disconnected." });
      qc.invalidateQueries({ queryKey: ["agency-dashboard", accountId, month] });
    },
  });

  function openGscDialog() {
    const unconfigured = seo.gsc?.unconfiguredSites ?? [];
    const first = unconfigured[0];
    setGscWebsiteId(first?.id ?? "");
    setGscSiteUrlInput(first?.suggestedUrl ?? "");
    setGscError("");
    setGscDialog(true);
  }

  function copyEmail() {
    const email = saEmailData?.email ?? "";
    navigator.clipboard.writeText(email).then(() => {
      setGscCopied(true);
      setTimeout(() => setGscCopied(false), 2000);
    });
  }

  // ── Book job mutation ───────────────────────────────────────────────────────
  const markBooked = useMutation({
    mutationFn: ({ leadId, value }: { leadId: string; value: string }) =>
      api.post<any>("/api/leads/update-status", {
        leadId, status: "booked", jobValue: parseFloat(value), accountId,
      }),
    onSuccess: (data) => {
      toast({
        title: "Job recorded",
        description: `${fmtCurrency(parseFloat(jobValue))} booked. Job ID: ${data.bookedJobId?.slice(0, 8)}…`,
      });
      qc.invalidateQueries({ queryKey: ["agency-dashboard", accountId, month] });
      qc.invalidateQueries({ queryKey: ["booked-job-metrics", accountId, month] });
      qc.invalidateQueries({ queryKey: ["agency-leads"] });
      setBookDialog(null);
      setJobValue("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const leads = rawLeads ?? [];
  const jobs = jobMetrics?.jobs ?? [];
  const roi = summary?.roi ?? {};
  const seo = summary?.seo ?? {};
  const hasSpend = (roi.monthlySpend ?? 0) > 0;
  const hasActivity = (summary?.leads?.totalLeads ?? 0) > 0 || (summary?.leads?.bookedJobs ?? 0) > 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {summary?.accountName ? `${summary.accountName} — ` : ""}Leads &amp; ROI
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Track SEO performance, lead flow, and return on investment.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Monthly spend inline edit */}
            <div className="flex items-center gap-1.5 border rounded-md px-3 py-1.5 bg-background text-sm">
              <DollarSign className="size-3.5 text-muted-foreground shrink-0" />
              {spendEditing ? (
                <>
                  <input
                    ref={spendInputRef}
                    type="number"
                    min="0"
                    step="100"
                    className="w-24 outline-none bg-transparent text-sm"
                    value={spendInput}
                    onChange={(e) => setSpendInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveSpend(); if (e.key === "Escape") setSpendEditing(false); }}
                    onBlur={saveSpend}
                    autoFocus
                    data-testid="input-monthly-spend"
                    placeholder="0"
                  />
                  <span className="text-muted-foreground">/mo</span>
                  {updateSpend.isPending ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <button onClick={saveSpend} className="text-emerald-600 hover:text-emerald-700">
                      <Check className="size-3.5" />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="text-muted-foreground text-xs">
                    {hasSpend ? `${fmtCurrency(roi.monthlySpend)}/mo investment` : "Set monthly investment"}
                  </span>
                  <button
                    onClick={() => { setSpendEditing(true); setTimeout(() => spendInputRef.current?.focus(), 50); }}
                    className="text-muted-foreground hover:text-foreground ml-1"
                    data-testid="button-edit-spend"
                  >
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
            </div>

            {/* Account selector */}
            {user?.isSuperAdmin && accounts && (
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="w-48" data-testid="select-account">
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Month picker */}
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-44" data-testid="select-month">
                <CalendarDays className="size-4 mr-1 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── ROI Impact section (when spend is set) ───────────────────────── */}
        {hasSpend ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target className="size-4 text-emerald-600" />
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                ROI Impact — {fmtCurrency(roi.monthlySpend)} invested
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <RoiCard
                label="ROI Multiple"
                value={roi.roiMultiple != null ? `${roi.roiMultiple}x` : "—"}
                sub="Revenue per $1 invested"
                accent="border-l-emerald-500"
                loading={summaryLoading && !!accountId}
              />
              <RoiCard
                label="Revenue This Month"
                value={roi.totalJobValue != null ? fmtCurrency(roi.totalJobValue) : "—"}
                sub="Total attributed revenue"
                accent="border-l-blue-500"
                loading={summaryLoading && !!accountId}
              />
              <RoiCard
                label="Net Revenue"
                value={roi.netRevenue != null ? (roi.netRevenue >= 0 ? `+${fmtCurrency(roi.netRevenue)}` : fmtCurrency(roi.netRevenue)) : "—"}
                sub="Revenue minus investment"
                accent={roi.netRevenue >= 0 ? "border-l-emerald-400" : "border-l-red-400"}
                loading={summaryLoading && !!accountId}
              />
              <RoiCard
                label="Cost Per Lead"
                value={roi.cpl != null ? fmtCurrency(roi.cpl) : "—"}
                sub="Per call or form submission"
                accent="border-l-violet-500"
                loading={summaryLoading && !!accountId}
              />
              <RoiCard
                label="Cost Per Booking"
                value={roi.cpa != null ? fmtCurrency(roi.cpa) : "—"}
                sub="Per booked job"
                accent="border-l-amber-500"
                loading={summaryLoading && !!accountId}
              />
            </div>
            {!hasActivity && !summaryLoading && (
              <p className="text-xs text-muted-foreground mt-2">
                No leads or booked jobs this month yet — ROI metrics will populate as activity comes in.
              </p>
            )}
          </div>
        ) : (
          !summaryLoading && !!accountId && (
            <div className="rounded-xl border border-dashed p-5 flex items-center gap-4 bg-muted/30">
              <Target className="size-8 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Unlock ROI Metrics</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click the <strong>Set monthly investment</strong> field above to enter this client's monthly SEO spend.
                  We'll calculate CPL, CPA, ROI multiple, and net revenue automatically.
                </p>
              </div>
            </div>
          )
        )}

        {/* ── Activity stat cards ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="size-4 text-amber-500" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Lead Activity
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={PhoneCall} label="Calls This Month"
              value={summary?.calls?.thisMonth ?? "—"}
              sub={summary?.calls?.thisMonth ? `Avg ${summary.calls.avgDuration}` : undefined}
              color="text-blue-500" loading={summaryLoading && !!accountId}
            />
            <StatCard
              icon={FileText} label="Form Submissions"
              value={summary?.forms?.thisMonth ?? "—"}
              sub={summary?.forms?.thisMonth ? `${summary.forms.conversionRate} of total leads` : undefined}
              color="text-violet-500" loading={summaryLoading && !!accountId}
            />
            <StatCard
              icon={CheckCircle} label="Booked Jobs"
              value={summary?.leads?.bookedJobs ?? "—"}
              sub={summary?.leads?.bookedJobs ? `${summary.leads.totalLeads} total leads` : undefined}
              color="text-emerald-500" loading={summaryLoading && !!accountId}
            />
            <StatCard
              icon={DollarSign} label="Revenue Attributed"
              value={summary?.leads?.totalJobValue != null ? fmtCurrency(summary.leads.totalJobValue) : "—"}
              sub={summary?.leads?.bookedJobs ? `Avg ${fmtCurrency(summary.leads.avgJobValue ?? 0)} / job` : undefined}
              color="text-amber-500" loading={summaryLoading && !!accountId}
            />
          </div>
        </div>

        {/* ── SEO Performance ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="size-4 text-blue-500" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              SEO Performance
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">

            {/* Page tier breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" />
                  Published Pages
                </CardTitle>
                <CardDescription>Content indexed and active in Google.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {summaryLoading && !!accountId ? (
                  <Skeleton className="h-16 w-full" />
                ) : seo.total === 0 ? (
                  <p className="text-sm text-muted-foreground">No published pages yet.</p>
                ) : (
                  <>
                    <TierBar t1={seo.tier1} t2={seo.tier2} t3={seo.tier3} />
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Tier 1 — Google Priority", value: seo.tier1, color: "text-emerald-600", badgeCls: "bg-emerald-100 text-emerald-700" },
                        { label: "Tier 2 — Live", value: seo.tier2, color: "text-blue-600", badgeCls: "bg-blue-100 text-blue-700" },
                        { label: "Tier 3 — Indexed", value: seo.tier3, color: "text-gray-500", badgeCls: "bg-gray-100 text-gray-600" },
                        { label: "Total Published", value: seo.total, color: "text-foreground", badgeCls: "bg-gray-100 text-gray-700" },
                      ].map((s) => (
                        <div key={s.label} className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{s.label}</span>
                          <span className={`text-sm font-bold ${s.color}`}>{s.value ?? 0}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-1 border-t">
                      <span className="text-xs text-muted-foreground">Avg quality score</span>
                      <span className={`text-sm font-bold ml-auto ${(seo.avgScore ?? 0) >= 80 ? "text-emerald-600" : (seo.avgScore ?? 0) >= 60 ? "text-amber-600" : "text-gray-500"}`}>
                        {seo.avgScore ?? "—"}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Organic Reach — real GSC data or estimates */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ArrowUpRight className="size-4 text-muted-foreground" />
                      Organic Reach
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {seo.gsc?.connected
                        ? "Live data from Google Search Console."
                        : "Estimates based on page tier and quality scores."}
                    </CardDescription>
                  </div>
                  {seo.gsc?.connected ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live · GSC
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted border border-dashed rounded-full px-2 py-0.5 shrink-0">
                      Estimated
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {summaryLoading && !!accountId ? (
                  <Skeleton className="h-24 w-full" />
                ) : seo.total === 0 ? (
                  <p className="text-sm text-muted-foreground">Publish pages to see reach data.</p>
                ) : seo.gsc?.connected ? (
                  /* ── Real GSC data ── */
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-blue-600" data-testid="stat-gsc-impressions">
                          {fmtNum(seo.gsc.impressions ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">Impressions (last 28d)</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-violet-600" data-testid="stat-gsc-clicks">
                          {fmtNum(seo.gsc.clicks ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">Clicks (last 28d)</div>
                      </div>
                    </div>
                    {seo.gsc.avgPosition != null && (
                      <div className="flex items-center gap-2 text-xs border-t pt-3">
                        <span className="text-muted-foreground">Average position</span>
                        <span className="font-semibold ml-auto">{seo.gsc.avgPosition}</span>
                      </div>
                    )}
                    {/* Disconnect links */}
                    <div className="border-t pt-3 flex flex-wrap gap-2">
                      {seo.gsc.connectedSites?.map((s: any) => (
                        <div key={s.websiteId} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1">
                          <Link2 className="size-3 text-emerald-500" />
                          <span className="truncate max-w-[140px]">{s.domain}</span>
                          <button
                            className="ml-1 text-muted-foreground hover:text-destructive"
                            title="Disconnect"
                            data-testid={`button-gsc-disconnect-${s.websiteId}`}
                            onClick={() => gscDisconnect.mutate(s.websiteId)}
                            disabled={gscDisconnect.isPending}
                          >
                            <Link2Off className="size-3" />
                          </button>
                        </div>
                      ))}
                      {(seo.gsc.unconfiguredSites?.length ?? 0) > 0 && (
                        <button
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          onClick={openGscDialog}
                          data-testid="button-gsc-connect-more"
                        >
                          <Link2 className="size-3" />
                          Connect more sites
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Estimate + connect CTA ── */
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-blue-600/60" data-testid="stat-est-impressions">
                          ~{fmtNum(seo.estImpressions ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">Est. monthly impressions</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-2xl font-bold text-violet-600/60" data-testid="stat-est-clicks">
                          ~{fmtNum(seo.estClicks ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">Est. monthly clicks</div>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-xs text-muted-foreground border-t pt-3">
                      <div className="flex justify-between">
                        <span>Tier 1 pages ({seo.tier1})</span>
                        <span>~{fmtNum((seo.tier1 ?? 0) * 200)} impressions</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tier 2 pages ({seo.tier2})</span>
                        <span>~{fmtNum((seo.tier2 ?? 0) * 30)} impressions</span>
                      </div>
                      {(seo.tier3 ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span>Tier 3 pages ({seo.tier3})</span>
                          <span>~{fmtNum((seo.tier3 ?? 0) * 8)} impressions</span>
                        </div>
                      )}
                    </div>
                    {(seo.gsc?.unconfiguredSites?.length ?? 0) > 0 && (
                      <Button
                        variant="outline" size="sm" className="w-full gap-2 mt-1"
                        onClick={openGscDialog}
                        data-testid="button-gsc-connect"
                      >
                        <Link2 className="size-3.5" />
                        Connect Google Search Console
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Top pages + call performance ─────────────────────────────────── */}
        {summary && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Top Pages by Calls</CardTitle>
                <CardDescription>Pages generating the most inbound calls this month.</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.calls.topPages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No call data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.calls.topPages.map(([title, count]: [string, number], i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm gap-3">
                        <span className="text-muted-foreground truncate text-xs flex-1">
                          {i + 1}. {title}
                        </span>
                        <Badge variant="secondary" className="shrink-0">{count} call{count !== 1 ? "s" : ""}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Top Pages by Forms</CardTitle>
                <CardDescription>Pages driving the most form submissions this month.</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.forms.topPages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No form data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.forms.topPages.map(([title, count]: [string, number], i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm gap-3">
                        <span className="text-muted-foreground truncate text-xs flex-1">
                          {i + 1}. {title}
                        </span>
                        <Badge variant="secondary" className="shrink-0">{count} form{count !== 1 ? "s" : ""}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Form Submissions table ───────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4 text-violet-500" />
                  Form Submissions
                </CardTitle>
                <CardDescription className="mt-1">
                  {leadsLoading ? "Loading…" : `${leads.length} submission${leads.length !== 1 ? "s" : ""} this month`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!accountId ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                Select an account to see submissions.
              </div>
            ) : leadsLoading ? (
              <div className="px-6 py-4 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No form submissions this month.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submitter</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Source Page</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead: any) => (
                      <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                        <TableCell className="font-medium">
                          {lead.submitterName || <span className="text-muted-foreground italic">Anonymous</span>}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs space-y-0.5">
                            {lead.submitterEmail && <div className="text-muted-foreground">{lead.submitterEmail}</div>}
                            {lead.submitterPhone && <div className="text-muted-foreground">{lead.submitterPhone}</div>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          {lead.sourcePageTitle ? (
                            <span className="text-xs line-clamp-2">{lead.sourcePageTitle}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground font-mono">
                              {lead.sourcePageUrl?.split("/").pop() ?? "—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <span className="text-xs text-muted-foreground line-clamp-2">{lead.message || "—"}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(lead.formTimestamp)}
                        </TableCell>
                        <TableCell className="text-right">
                          {lead.bookedJob ? (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium"
                              data-testid={`badge-booked-${lead.id}`}
                            >
                              <CheckCircle className="size-3" />
                              Booked
                            </span>
                          ) : (
                            <Button
                              size="sm" variant="outline" className="text-xs gap-1"
                              data-testid={`button-book-lead-${lead.id}`}
                              onClick={() => setBookDialog({ leadId: lead.id, name: lead.submitterName || lead.submitterEmail || "this lead" })}
                            >
                              <DollarSign className="size-3" />
                              Book Job
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Booked Jobs table ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-500" />
              Booked Jobs
            </CardTitle>
            <CardDescription>
              {jobsLoading ? "Loading…" : `${jobs.length} job${jobs.length !== 1 ? "s" : ""} booked this month — ${fmtCurrency(jobMetrics?.totalJobValue ?? 0)} total`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!accountId ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">Select an account to see booked jobs.</div>
            ) : jobsLoading ? (
              <div className="px-6 py-4 space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : jobs.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No jobs booked this month yet. Use the <strong>Book Job</strong> button above to record one.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job ID</TableHead>
                      <TableHead>Job Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Booked Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job: any) => (
                      <TableRow key={job.id} data-testid={`row-job-${job.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {job.id.slice(0, 8)}…
                        </TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          {fmtCurrency(parseFloat(job.jobValue ?? "0"))}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize">{job.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(job.bookedDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── GSC Connect Dialog ── */}
      <Dialog open={gscDialog} onOpenChange={(open) => { if (!open) { setGscDialog(false); setGscError(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-4 text-blue-500" />
              Connect Google Search Console
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Step 1 */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Step 1 — Add the service account to your property</p>
              {saEmailData?.configured ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    In <strong>Google Search Console</strong>, go to Settings → Users and permissions → Add user, then paste this email with <strong>Full</strong> permission:
                  </p>
                  <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                    <code className="text-xs flex-1 break-all">{saEmailData.email}</code>
                    <button
                      onClick={copyEmail}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title="Copy"
                      data-testid="button-copy-sa-email"
                    >
                      {gscCopied ? <CheckCheck className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  The Google service account is not configured. Contact your platform admin to set up the Google integration.
                </p>
              )}
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Step 2 — Enter your GSC property URL</p>
              <p className="text-xs text-muted-foreground">
                Use the exact URL shown in Search Console (e.g. <code>https://example.com/</code> or <code>sc-domain:example.com</code>).
              </p>

              {/* Website selector if multiple sites */}
              {(seo.gsc?.unconfiguredSites?.length ?? 0) > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs">Website</Label>
                  <Select
                    value={gscWebsiteId}
                    onValueChange={(id) => {
                      setGscWebsiteId(id);
                      const site = seo.gsc.unconfiguredSites.find((s: any) => s.id === id);
                      setGscSiteUrlInput(site?.suggestedUrl ?? "");
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm" data-testid="select-gsc-website">
                      <SelectValue placeholder="Select website…" />
                    </SelectTrigger>
                    <SelectContent>
                      {seo.gsc.unconfiguredSites.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.domain}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="gsc-site-url" className="text-xs">Property URL</Label>
                <Input
                  id="gsc-site-url"
                  placeholder="https://yourdomain.com/"
                  value={gscSiteUrlInput}
                  onChange={(e) => setGscSiteUrlInput(e.target.value)}
                  data-testid="input-gsc-site-url"
                  disabled={!saEmailData?.configured}
                />
              </div>

              {gscError && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {gscError}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGscDialog(false); setGscError(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!gscSiteUrlInput || !gscWebsiteId || !saEmailData?.configured || gscConnect.isPending}
              data-testid="button-gsc-test-connect"
              onClick={() => gscConnect.mutate({ websiteId: gscWebsiteId, siteUrl: gscSiteUrlInput })}
            >
              {gscConnect.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Link2 className="size-4 mr-2" />}
              Test &amp; Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Book Job Dialog ── */}
      <Dialog open={!!bookDialog} onOpenChange={(open) => { if (!open) { setBookDialog(null); setJobValue(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Booked Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Recording a booked job for <strong>{bookDialog?.name}</strong>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="job-value">Job Value ($)</Label>
              <Input
                id="job-value" type="number" min="0" step="100" placeholder="e.g. 5000"
                value={jobValue} onChange={(e) => setJobValue(e.target.value)}
                data-testid="input-job-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBookDialog(null); setJobValue(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!jobValue || isNaN(parseFloat(jobValue)) || markBooked.isPending}
              data-testid="button-confirm-book"
              onClick={() => { if (bookDialog) markBooked.mutate({ leadId: bookDialog.leadId, value: jobValue }); }}
            >
              {markBooked.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Record Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
