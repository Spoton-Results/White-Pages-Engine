import { useState, useMemo } from "react";
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
  Clock, CheckCircle, Loader2, CalendarDays,
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
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

  // ── Accounts list (superAdmin only) ─────────────────────────────────────
  const { data: accounts } = useQuery<any[]>({
    queryKey: ["accounts-list"],
    queryFn: () => api.get<any[]>("/api/accounts"),
    enabled: !!user?.isSuperAdmin,
  });

  // Resolve which account we're viewing
  const accountId = user?.isSuperAdmin
    ? selectedAccountId
    : user?.accountId ?? "";

  // Auto-select first account for superAdmins
  useMemo(() => {
    if (user?.isSuperAdmin && accounts?.length && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, user?.isSuperAdmin, selectedAccountId]);

  // ── Dashboard summary ────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["agency-dashboard", accountId, month],
    queryFn: () => api.get<any>(`/api/dashboard/agency/${accountId}?month=${month}`),
    enabled: !!accountId,
  });

  // ── Websites for the account ─────────────────────────────────────────────
  const { data: allWebsites } = useQuery<any[]>({
    queryKey: ["all-websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
    enabled: !!accountId,
  });

  const accountWebsites = useMemo(
    () => (allWebsites ?? []).filter((w: any) => w.accountId === accountId),
    [allWebsites, accountId],
  );

  // ── Form submissions (leads) across all websites ─────────────────────────
  const { data: rawLeads, isLoading: leadsLoading } = useQuery<any[]>({
    queryKey: ["agency-leads", accountId, month, accountWebsites.map((w: any) => w.id).join(",")],
    queryFn: async () => {
      if (!accountWebsites.length) return [];
      const results = await Promise.all(
        accountWebsites.map((w: any) =>
          api.get<any>(`/api/form-tracking/leads/${w.id}?month=${month}`)
            .then((r: any) => r.leads ?? [])
            .catch(() => [] as any[]),
        ),
      );
      return results
        .flat()
        .sort((a: any, b: any) =>
          new Date(b.formTimestamp).getTime() - new Date(a.formTimestamp).getTime(),
        );
    },
    enabled: accountWebsites.length > 0,
  });

  // ── Booked jobs metrics ──────────────────────────────────────────────────
  const { data: jobMetrics, isLoading: jobsLoading } = useQuery<any>({
    queryKey: ["booked-job-metrics", accountId, month],
    queryFn: () => api.get<any>(`/api/leads/metrics/${accountId}?month=${month}`),
    enabled: !!accountId,
  });

  // ── Mark as booked mutation ──────────────────────────────────────────────
  const markBooked = useMutation({
    mutationFn: ({ leadId, value }: { leadId: string; value: string }) =>
      api.post<any>("/api/leads/update-status", {
        leadId,
        status: "booked",
        jobValue: parseFloat(value),
        accountId,
      }),
    onSuccess: (data) => {
      toast({
        title: "Job recorded",
        description: `$${parseFloat(jobValue).toLocaleString()} booked. Job ID: ${data.bookedJobId?.slice(0, 8)}…`,
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

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Leads & Conversions</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Track calls, form submissions, and booked jobs by month.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Account selector — super admins only */}
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

        {/* ── Stat cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={PhoneCall}
            label="Calls This Month"
            value={summary?.calls?.thisMonth ?? "—"}
            sub={summary?.calls?.thisMonth ? `Avg ${summary.calls.avgDuration}` : undefined}
            color="text-blue-500"
            loading={summaryLoading && !!accountId}
          />
          <StatCard
            icon={FileText}
            label="Form Submissions"
            value={summary?.forms?.thisMonth ?? "—"}
            sub={summary?.forms?.thisMonth ? `${summary.forms.conversionRate} of total leads` : undefined}
            color="text-violet-500"
            loading={summaryLoading && !!accountId}
          />
          <StatCard
            icon={CheckCircle}
            label="Booked Jobs"
            value={summary?.leads?.bookedJobs ?? "—"}
            sub={summary?.leads?.bookedJobs ? `${summary.leads.totalLeads} total leads` : undefined}
            color="text-emerald-500"
            loading={summaryLoading && !!accountId}
          />
          <StatCard
            icon={DollarSign}
            label="Revenue Attributed"
            value={summary?.leads?.totalJobValue != null ? fmtCurrency(summary.leads.totalJobValue) : "—"}
            sub={summary?.leads?.bookedJobs ? `Avg ${fmtCurrency(summary.leads.avgJobValue ?? 0)} / job` : undefined}
            color="text-amber-500"
            loading={summaryLoading && !!accountId}
          />
        </div>

        {/* ── Top pages + call performance ── */}
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
                    {summary.calls.topPages.map(([pageId, count]: [string, number], i: number) => (
                      <div key={pageId} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate max-w-[280px] font-mono text-xs">
                          {i + 1}. {pageId.slice(0, 8)}…
                        </span>
                        <Badge variant="secondary">{count} call{count !== 1 ? "s" : ""}</Badge>
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
                    {summary.forms.topPages.map(([pageId, count]: [string, number], i: number) => (
                      <div key={pageId} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate max-w-[280px] font-mono text-xs">
                          {i + 1}. {pageId.slice(0, 8)}…
                        </span>
                        <Badge variant="secondary">{count} form{count !== 1 ? "s" : ""}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Form Submissions table ── */}
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
                            {lead.submitterEmail && (
                              <div className="text-muted-foreground">{lead.submitterEmail}</div>
                            )}
                            {lead.submitterPhone && (
                              <div className="text-muted-foreground">{lead.submitterPhone}</div>
                            )}
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
                          <span className="text-xs text-muted-foreground line-clamp-2">
                            {lead.message || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(lead.formTimestamp)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs gap-1"
                            data-testid={`button-book-lead-${lead.id}`}
                            onClick={() => setBookDialog({ leadId: lead.id, name: lead.submitterName || lead.submitterEmail || "this lead" })}
                          >
                            <DollarSign className="size-3" />
                            Book Job
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Booked Jobs table ── */}
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
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                Select an account to see booked jobs.
              </div>
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
                id="job-value"
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 5000"
                value={jobValue}
                onChange={(e) => setJobValue(e.target.value)}
                data-testid="input-job-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setBookDialog(null); setJobValue(""); }}
            >
              Cancel
            </Button>
            <Button
              disabled={!jobValue || isNaN(parseFloat(jobValue)) || markBooked.isPending}
              data-testid="button-confirm-book"
              onClick={() => {
                if (bookDialog) {
                  markBooked.mutate({ leadId: bookDialog.leadId, value: jobValue });
                }
              }}
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
