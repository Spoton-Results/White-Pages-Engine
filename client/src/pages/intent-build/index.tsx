import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Database, GitBranch, Layers, Link2, Merge, Play, RefreshCcw, Search, ShieldCheck, Sparkles, Target, TrendingUp, XCircle } from "lucide-react";

type BuildStatus = "idle" | "running" | "complete" | "failed";
type IntentAction = "promote" | "link" | "improve" | "consolidate" | "merge";

interface WebsiteOption { id: string; name: string; domain: string; }
interface CanonicalOwner { canonicalOwner: string; intentCluster: string; pagesOwned: number; strength: "Strong" | "Medium" | "Weak"; risk: "Low" | "Medium" | "High"; recommendedAction: string; }
interface BuildStatusResponse { status: BuildStatus; progress: number; currentStep: string; completedCount: number; totalCount: number; lastRunTime: string | null; pagesAnalyzed: number; error?: string; }
interface IntentReport { totalPagesAnalyzed: number; canonicalOwnersFound: number; orphanIntentGroups: number; duplicateOverlapRisks: number; weakOwnerClusters: number; promotionCandidates: number; coveragePercentage: number; strongOwners: number; mediumOwners: number; weakOwners: number; missingCanonicalOwners: number; topCanonicalOwners: CanonicalOwner[]; }
interface AppliedAction { action: IntentAction | "run_changes"; label: string; detail: string; appliedAt: string; }
interface GovernancePreview { action: "consolidate" | "merge"; winner: { id: string; slug: string; title: string; tier?: number; pageType?: string }; affectedPages: Array<{ id: string; slug: string; title: string; status: string; tier?: number; pageType?: string }>; plannedChanges: string[]; safetyRules: string[]; counts: { affectedPages: number; internalLinksToRepair: number }; }
interface PendingGovernance { owner: CanonicalOwner; action: "consolidate" | "merge"; preview: GovernancePreview; }

const emptyStatus: BuildStatusResponse = { status: "idle", progress: 0, currentStep: "Waiting to run", completedCount: 0, totalCount: 6, lastRunTime: null, pagesAnalyzed: 0 };
const emptyReport: IntentReport = { totalPagesAnalyzed: 0, canonicalOwnersFound: 0, orphanIntentGroups: 0, duplicateOverlapRisks: 0, weakOwnerClusters: 0, promotionCandidates: 0, coveragePercentage: 0, strongOwners: 0, mediumOwners: 0, weakOwners: 0, missingCanonicalOwners: 0, topCanonicalOwners: [] };

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

function cleanSlug(value: string) { return value.replace(/^\/+/, "").replace(/^pages\//, ""); }
function getStrengthBadge(strength: CanonicalOwner["strength"]) { if (strength === "Strong") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Strong</Badge>; if (strength === "Medium") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Medium</Badge>; return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Weak</Badge>; }
function getRiskBadge(risk: CanonicalOwner["risk"]) { if (risk === "Low") return <Badge variant="outline" className="border-green-200 text-green-700">Low</Badge>; if (risk === "Medium") return <Badge variant="outline" className="border-yellow-200 text-yellow-700">Medium</Badge>; return <Badge variant="outline" className="border-red-200 text-red-700">High</Badge>; }
function recommendedPrimaryAction(owner: CanonicalOwner): IntentAction { const r = owner.recommendedAction.toLowerCase(); if (r.includes("promote")) return "promote"; if (r.includes("link")) return "link"; if (r.includes("consolidate")) return "consolidate"; if (r.includes("merge")) return "merge"; if (r.includes("improve") || r.includes("strengthen")) return "improve"; if (owner.risk === "High" && owner.pagesOwned > 1) return "consolidate"; if (owner.strength === "Strong") return "promote"; if (owner.strength === "Medium") return "link"; return "improve"; }
function actionButtonLabel(action: IntentAction) { if (action === "promote") return "Promote"; if (action === "link") return "Add Links"; if (action === "improve") return "Improve"; if (action === "consolidate") return "Preview Consolidate"; return "Preview Merge"; }
function actionButtonIcon(action: IntentAction) { if (action === "promote") return <TrendingUp className="h-3.5 w-3.5" />; if (action === "link") return <Link2 className="h-3.5 w-3.5" />; if (action === "improve") return <Sparkles className="h-3.5 w-3.5" />; if (action === "consolidate") return <Layers className="h-3.5 w-3.5" />; return <Merge className="h-3.5 w-3.5" />; }
function actionEndpoint(action: IntentAction) { return action === "link" ? "/api/intent-build/add-links" : `/api/intent-build/${action}`; }
function actionLabel(action: IntentAction) { if (action === "promote") return "Promoted"; if (action === "link") return "Links Added"; if (action === "improve") return "Improve Job Queued"; if (action === "consolidate") return "Governance Preview Ready"; return "Governance Preview Ready"; }

export default function IntentBuildPage() {
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>("");
  const [status, setStatus] = useState<BuildStatusResponse>(emptyStatus);
  const [report, setReport] = useState<IntentReport>(emptyReport);
  const [hasRun, setHasRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [appliedActions, setAppliedActions] = useState<Record<string, AppliedAction>>({});
  const [pendingGovernance, setPendingGovernance] = useState<PendingGovernance | null>(null);

  const selectedWebsite = useMemo(() => websites.find(w => w.id === selectedWebsiteId), [websites, selectedWebsiteId]);
  const owners = report.topCanonicalOwners || [];
  const completedActions = Object.values(appliedActions);

  async function loadWebsites() {
    const rows = await fetchJson<WebsiteOption[]>("/api/websites");
    setWebsites(rows);
    if (!selectedWebsiteId && rows[0]?.id) setSelectedWebsiteId(rows[0].id);
  }

  async function loadStatusAndReport(websiteId = selectedWebsiteId) {
    if (!websiteId) return;
    const [liveStatus, liveReport] = await Promise.all([
      fetchJson<BuildStatusResponse>(`/api/websites/${websiteId}/intent-build/status`),
      fetchJson<IntentReport>(`/api/websites/${websiteId}/intent-build/report`),
    ]);
    setStatus(liveStatus);
    setReport(liveReport);
    setHasRun(liveStatus.status !== "idle" || liveReport.totalPagesAnalyzed > 0);
  }

  useEffect(() => { loadWebsites().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (selectedWebsiteId) loadStatusAndReport(selectedWebsiteId).catch(e => setError(e.message)); }, [selectedWebsiteId]);
  useEffect(() => { if (!selectedWebsiteId || status.status !== "running") return; const timer = window.setInterval(() => loadStatusAndReport(selectedWebsiteId).catch(e => setError(e.message)), 1500); return () => window.clearInterval(timer); }, [selectedWebsiteId, status.status]);

  async function handleRunBuild() {
    if (!selectedWebsiteId || status.status === "running") return;
    setError(null); setAppliedActions({}); setPendingGovernance(null);
    await fetchJson(`/api/websites/${selectedWebsiteId}/intent-build/run`, { method: "POST", body: JSON.stringify({}) });
    setHasRun(true);
    await loadStatusAndReport(selectedWebsiteId);
  }

  async function handleRefresh() { setError(null); await loadStatusAndReport(); }

  function governancePayload(owner: CanonicalOwner, action: "consolidate" | "merge") {
    return { websiteId: selectedWebsiteId, canonicalOwner: owner.canonicalOwner, slug: cleanSlug(owner.canonicalOwner), intentCluster: owner.intentCluster, action };
  }

  async function previewGovernanceAction(owner: CanonicalOwner, action: "consolidate" | "merge") {
    if (!selectedWebsiteId) return;
    const key = `${owner.canonicalOwner}:${owner.intentCluster}:${action}:preview`;
    setActionBusy(key); setError(null);
    try {
      const data = await fetchJson<{ ok: boolean; preview: GovernancePreview }>("/api/intent-build/governance-preview", { method: "POST", body: JSON.stringify(governancePayload(owner, action)) });
      setPendingGovernance({ owner, action, preview: data.preview });
      setAppliedActions(current => ({ ...current, [key]: { action, label: actionLabel(action), detail: `${owner.canonicalOwner} preview ready: ${data.preview.counts.affectedPages} affected page(s), ${data.preview.counts.internalLinksToRepair} links to repair`, appliedAt: new Date().toLocaleString() } }));
    } catch (e: any) { setError(e.message || "Preview failed"); }
    finally { setActionBusy(null); }
  }

  async function runGovernanceChanges() {
    if (!selectedWebsiteId || !pendingGovernance) return;
    const { owner, action } = pendingGovernance;
    const key = `${owner.canonicalOwner}:${owner.intentCluster}:${action}:run`;
    setActionBusy(key); setError(null);
    try {
      const result: any = await fetchJson("/api/intent-build/run-governance-action", { method: "POST", body: JSON.stringify(governancePayload(owner, action)) });
      setAppliedActions(current => ({ ...current, [key]: { action: "run_changes", label: "Governance Changes Executed", detail: `${result.winnerSlug}: ${result.affectedPages} page(s) reviewed, ${result.internalLinksUpdated} internal link(s) updated, job ${result.jobId}`, appliedAt: new Date().toLocaleString() } }));
      setPendingGovernance(null);
      await loadStatusAndReport(selectedWebsiteId);
    } catch (e: any) { setError(e.message || "Run changes failed"); }
    finally { setActionBusy(null); }
  }

  async function applyRecommendedAction(owner: CanonicalOwner, action: IntentAction) {
    if (!selectedWebsiteId) return;
    if (action === "consolidate" || action === "merge") return previewGovernanceAction(owner, action);
    const key = `${owner.canonicalOwner}:${owner.intentCluster}:${action}`;
    setActionBusy(key); setError(null);
    try {
      const payload = { websiteId: selectedWebsiteId, canonicalOwner: owner.canonicalOwner, slug: cleanSlug(owner.canonicalOwner), intentCluster: owner.intentCluster };
      const result: any = await fetchJson(actionEndpoint(action), { method: "POST", body: JSON.stringify(payload) });
      setAppliedActions(current => ({ ...current, [key]: { action, label: actionLabel(action), detail: result.jobId ? `${owner.canonicalOwner} → job ${result.jobId}` : `${owner.canonicalOwner} updated successfully`, appliedAt: new Date().toLocaleString() } }));
      await loadStatusAndReport(selectedWebsiteId);
    } catch (e: any) { setError(e.message || "Action failed"); }
    finally { setActionBusy(null); }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div><div className="flex items-center gap-2"><div className="rounded-lg bg-blue-50 p-2 text-blue-700"><Target className="h-5 w-5" /></div><h1 className="text-2xl font-bold tracking-tight text-gray-900">Intent Ownership Build</h1></div><p className="mt-2 max-w-3xl text-sm text-gray-500">Live canonical-owner report, approval-based governance actions, internal-link actions, and non-destructive search architecture controls.</p></div>
          <div className="flex flex-col gap-3 sm:flex-row"><Select value={selectedWebsiteId} onValueChange={setSelectedWebsiteId} disabled={loading || websites.length === 0}><SelectTrigger className="w-full sm:w-[280px]" data-testid="select-website"><SelectValue placeholder="Select website" /></SelectTrigger><SelectContent>{websites.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {w.domain}</SelectItem>)}</SelectContent></Select><Button onClick={handleRunBuild} disabled={!selectedWebsiteId || status.status === "running"} data-testid="btn-run-build" className="gap-2"><Play className="h-4 w-4" />{status.status === "running" ? "Running..." : "Run Build"}</Button><Button variant="outline" onClick={handleRefresh} disabled={!selectedWebsiteId || status.status === "running"} data-testid="btn-refresh" className="gap-2"><RefreshCcw className="h-4 w-4" />Refresh</Button></div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {pendingGovernance && <Card className="border-blue-200 bg-blue-50/40"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-blue-700" />Preview Changes Before Running</CardTitle><CardDescription>Human approval required. This version does not delete pages or create automatic redirects.</CardDescription></div><Button variant="ghost" size="sm" onClick={() => setPendingGovernance(null)}><XCircle className="h-4 w-4" /></Button></div></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><div className="rounded-lg border bg-white p-3"><p className="text-xs text-gray-500">Action</p><p className="font-semibold capitalize">{pendingGovernance.action}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs text-gray-500">Winner Page</p><p className="font-semibold">{pendingGovernance.preview.winner.slug}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs text-gray-500">Affected</p><p className="font-semibold">{pendingGovernance.preview.counts.affectedPages} pages · {pendingGovernance.preview.counts.internalLinksToRepair} links</p></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-lg border bg-white p-4"><p className="mb-2 font-semibold text-gray-900">Planned Changes</p><ul className="space-y-1 text-sm text-gray-600">{pendingGovernance.preview.plannedChanges.map((x, i) => <li key={i}>• {x}</li>)}</ul></div><div className="rounded-lg border bg-white p-4"><p className="mb-2 font-semibold text-gray-900">Safety Rules</p><ul className="space-y-1 text-sm text-gray-600">{pendingGovernance.preview.safetyRules.map((x, i) => <li key={i}>• {x}</li>)}</ul></div></div><div className="rounded-lg border bg-white"><Table><TableHeader><TableRow><TableHead>Affected Page</TableHead><TableHead>Title</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{pendingGovernance.preview.affectedPages.length === 0 ? <TableRow><TableCell colSpan={3} className="py-4 text-center text-sm text-gray-500">No overlapping pages found. Running changes will only log the governance decision.</TableCell></TableRow> : pendingGovernance.preview.affectedPages.slice(0, 8).map(p => <TableRow key={p.id}><TableCell className="font-medium">{p.slug}</TableCell><TableCell>{p.title || "—"}</TableCell><TableCell>{p.status}</TableCell></TableRow>)}</TableBody></Table></div><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setPendingGovernance(null)}>Cancel</Button><Button onClick={runGovernanceChanges} disabled={!!actionBusy} className="gap-2"><ShieldCheck className="h-4 w-4" />{actionBusy?.endsWith(":run") ? "Running..." : "Run Changes"}</Button></div></CardContent></Card>}

        <Card><CardHeader className="pb-3"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-gray-500" />Build Status</CardTitle><CardDescription>Current run state for {selectedWebsite?.name || "selected website"}</CardDescription></div><Badge className={status.status === "complete" ? "bg-green-100 text-green-800 hover:bg-green-100" : status.status === "running" ? "bg-blue-100 text-blue-800 hover:bg-blue-100" : status.status === "failed" ? "bg-red-100 text-red-800 hover:bg-red-100" : "bg-gray-100 text-gray-800 hover:bg-gray-100"}>{status.status.toUpperCase()}</Badge></div></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-4"><div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p><p className="mt-1 text-lg font-semibold capitalize text-gray-900">{status.status}</p></div><div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last Run</p><p className="mt-1 text-sm font-semibold text-gray-900">{status.lastRunTime ? new Date(status.lastRunTime).toLocaleString() : "Never"}</p></div><div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Website</p><p className="mt-1 text-sm font-semibold text-gray-900">{selectedWebsite?.domain || "—"}</p></div><div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pages Analyzed</p><p className="mt-1 text-lg font-semibold text-gray-900">{status.pagesAnalyzed.toLocaleString()}</p></div></div><div className="mt-6 space-y-2"><div className="flex items-center justify-between text-sm"><span className="font-medium text-gray-700">{status.currentStep}</span><span className="text-gray-500">{status.completedCount} / {status.totalCount}</span></div><Progress value={status.progress} /></div></CardContent></Card>

        {!hasRun && <Card className="border-dashed"><CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center"><div className="rounded-full bg-blue-50 p-4 text-blue-700"><Search className="h-8 w-8" /></div><h2 className="mt-4 text-lg font-semibold text-gray-900">No live Intent Ownership Build has been run yet</h2><p className="mt-2 max-w-2xl text-sm text-gray-500">Select a website and run the build to generate real canonical-owner data from published pages.</p><Button onClick={handleRunBuild} className="mt-5 gap-2" disabled={!selectedWebsiteId}><Play className="h-4 w-4" />Run First Build</Button></CardContent></Card>}

        {hasRun && <><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"><Card><CardContent className="p-4"><Database className="h-5 w-5 text-blue-600" /><p className="mt-3 text-2xl font-bold">{report.totalPagesAnalyzed.toLocaleString()}</p><p className="text-xs text-gray-500">Total pages analyzed</p></CardContent></Card><Card><CardContent className="p-4"><ShieldCheck className="h-5 w-5 text-green-600" /><p className="mt-3 text-2xl font-bold">{report.canonicalOwnersFound.toLocaleString()}</p><p className="text-xs text-gray-500">Canonical owners found</p></CardContent></Card><Card><CardContent className="p-4"><GitBranch className="h-5 w-5 text-orange-600" /><p className="mt-3 text-2xl font-bold">{report.orphanIntentGroups}</p><p className="text-xs text-gray-500">Orphan intent groups</p></CardContent></Card><Card><CardContent className="p-4"><AlertTriangle className="h-5 w-5 text-red-600" /><p className="mt-3 text-2xl font-bold">{report.duplicateOverlapRisks}</p><p className="text-xs text-gray-500">Duplicate overlap risks</p></CardContent></Card><Card><CardContent className="p-4"><Layers className="h-5 w-5 text-yellow-600" /><p className="mt-3 text-2xl font-bold">{report.weakOwnerClusters}</p><p className="text-xs text-gray-500">Weak owner clusters</p></CardContent></Card><Card><CardContent className="p-4"><BarChart3 className="h-5 w-5 text-purple-600" /><p className="mt-3 text-2xl font-bold">{report.promotionCandidates}</p><p className="text-xs text-gray-500">Promotion candidates</p></CardContent></Card></div>

        {completedActions.length > 0 && <Card><CardHeader><CardTitle className="text-base">Action Log</CardTitle><CardDescription>Backend actions, previews, and approved governance runs.</CardDescription></CardHeader><CardContent className="space-y-2">{completedActions.map((a, i) => <div key={`${a.action}-${i}`} className="rounded-lg border bg-gray-50 p-3 text-sm"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div className="font-medium text-gray-900">{a.label}</div><div className="text-xs text-gray-500">{a.appliedAt}</div></div><div className="mt-1 text-gray-600">{a.detail}</div></div>)}</CardContent></Card>}

        <div className="grid gap-6 lg:grid-cols-3"><Card className="lg:col-span-1"><CardHeader><CardTitle className="text-base">Owner Coverage Summary</CardTitle><CardDescription>How much of the site has clear canonical ownership.</CardDescription></CardHeader><CardContent className="space-y-5"><div><div className="flex items-center justify-between text-sm"><span className="font-medium text-gray-700">Coverage</span><span className="font-bold text-gray-900">{report.coveragePercentage}%</span></div><Progress value={report.coveragePercentage} className="mt-2" /></div><div className="grid grid-cols-2 gap-3"><div className="rounded-lg border p-3"><p className="text-xl font-bold text-green-700">{report.strongOwners}</p><p className="text-xs text-gray-500">Strong owners</p></div><div className="rounded-lg border p-3"><p className="text-xl font-bold text-yellow-700">{report.mediumOwners}</p><p className="text-xs text-gray-500">Medium owners</p></div><div className="rounded-lg border p-3"><p className="text-xl font-bold text-red-700">{report.weakOwners}</p><p className="text-xs text-gray-500">Weak owners</p></div><div className="rounded-lg border p-3"><p className="text-xl font-bold text-orange-700">{report.missingCanonicalOwners}</p><p className="text-xs text-gray-500">Missing owners</p></div></div><div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900"><div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" /><p>High-risk actions now require preview and manual Run Changes approval.</p></div></div></CardContent></Card>

        <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Top Canonical Owners</CardTitle><CardDescription>Consolidate and Merge now preview changes first, then require Run Changes approval.</CardDescription></CardHeader><CardContent><div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Canonical Owner</TableHead><TableHead>Intent Cluster</TableHead><TableHead className="text-right">Pages Owned</TableHead><TableHead>Strength</TableHead><TableHead>Risk</TableHead><TableHead>Recommended Action</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{owners.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-gray-500">No canonical owners found yet. Run or refresh the build.</TableCell></TableRow> : owners.map(owner => { const primary = recommendedPrimaryAction(owner); const actionChoices: IntentAction[] = owner.risk === "High" ? [primary, "improve", "merge"] : [primary, "link", "improve"]; const uniqueActions = [...new Set(actionChoices)]; return <TableRow key={`${owner.canonicalOwner}:${owner.intentCluster}`}><TableCell className="max-w-[220px] truncate font-medium">{owner.canonicalOwner}</TableCell><TableCell>{owner.intentCluster}</TableCell><TableCell className="text-right font-semibold">{owner.pagesOwned}</TableCell><TableCell>{getStrengthBadge(owner.strength)}</TableCell><TableCell>{getRiskBadge(owner.risk)}</TableCell><TableCell className="text-sm text-gray-600">{owner.recommendedAction}</TableCell><TableCell><div className="flex min-w-[220px] flex-wrap gap-2">{uniqueActions.map(action => { const busyKey = `${owner.canonicalOwner}:${owner.intentCluster}:${action}`; const previewBusyKey = `${owner.canonicalOwner}:${owner.intentCluster}:${action}:preview`; return <Button key={action} size="sm" variant={action === primary ? "default" : "outline"} className="h-8 gap-1.5 text-xs" disabled={!!actionBusy} onClick={() => applyRecommendedAction(owner, action)} data-testid={`btn-intent-${action}`}>{actionButtonIcon(action)}{actionBusy === busyKey || actionBusy === previewBusyKey ? "Working..." : actionButtonLabel(action)}</Button>; })}</div></TableCell></TableRow>; })}</TableBody></Table></div></CardContent></Card></div></>}
      </div>
    </DashboardLayout>
  );
}
