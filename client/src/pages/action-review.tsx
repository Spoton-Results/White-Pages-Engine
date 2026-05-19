import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Clock3, GitMerge, Layers3, RefreshCcw, ShieldAlert, XCircle } from "lucide-react";

interface WebsiteOption { id: string; name: string; domain: string; }
interface ReviewJob {
  id: string;
  name: string;
  status: string;
  type: string;
  intentCluster: string | null;
  reviewDecision?: string | null;
  winnerPageId: string | null;
  winnerSlug: string | null;
  winnerTitle: string | null;
  winnerTier: number | null;
  requiresConfirmation: boolean;
  redirectRequiredBeforePrune: boolean;
  destructiveActionAllowed: boolean;
  createdAt: string;
  completedAt: string | null;
  notes: any[];
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

export default function ActionReviewPage() {
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState("");
  const [jobs, setJobs] = useState<ReviewJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadWebsites() {
    const data = await fetchJson<WebsiteOption[]>("/api/websites");
    setWebsites(data);
    if (!selectedWebsiteId && data[0]?.id) setSelectedWebsiteId(data[0].id);
  }

  async function loadJobs(websiteId = selectedWebsiteId) {
    if (!websiteId) return;
    setLoading(true);
    try {
      const data = await fetchJson<ReviewJob[]>(`/api/websites/${websiteId}/action-review-active`);
      setJobs(data);
    } catch (e: any) {
      setError(e.message || "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWebsites().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (selectedWebsiteId) loadJobs(selectedWebsiteId);
  }, [selectedWebsiteId]);

  async function review(jobId: string, decision: "approved" | "rejected" | "needs_changes") {
    setBusyId(jobId + decision);
    setError(null);
    try {
      await fetchJson(`/api/action-review/${jobId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await loadJobs();
    } catch (e: any) {
      setError(e.message || "Review update failed");
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => ({
    total: jobs.length,
    merge: jobs.filter(j => j.type === "intent_merge_review").length,
    consolidation: jobs.filter(j => j.type === "intent_consolidation_review").length,
    pending: jobs.filter(j => j.status === "pending" || j.status === "running").length,
  }), [jobs]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-orange-50 p-2 text-orange-700"><ShieldAlert className="h-5 w-5" /></div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Action Review Queue</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">Human-reviewed merge and consolidation controls before redirects, pruning, or destructive SEO actions.</p>
          </div>
          <div className="flex gap-3">
            <Select value={selectedWebsiteId} onValueChange={setSelectedWebsiteId}>
              <SelectTrigger className="w-[320px]"><SelectValue placeholder="Select website" /></SelectTrigger>
              <SelectContent>{websites.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {w.domain}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={() => loadJobs()} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />Refresh</Button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="p-4"><Clock3 className="h-5 w-5 text-blue-600" /><p className="mt-3 text-2xl font-bold">{stats.total}</p><p className="text-xs text-gray-500">Active review jobs</p></CardContent></Card>
          <Card><CardContent className="p-4"><GitMerge className="h-5 w-5 text-red-600" /><p className="mt-3 text-2xl font-bold">{stats.merge}</p><p className="text-xs text-gray-500">Merge reviews</p></CardContent></Card>
          <Card><CardContent className="p-4"><Layers3 className="h-5 w-5 text-yellow-600" /><p className="mt-3 text-2xl font-bold">{stats.consolidation}</p><p className="text-xs text-gray-500">Consolidation reviews</p></CardContent></Card>
          <Card><CardContent className="p-4"><ShieldAlert className="h-5 w-5 text-orange-600" /><p className="mt-3 text-2xl font-bold">{stats.pending}</p><p className="text-xs text-gray-500">Pending review actions</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Review Queue</CardTitle>
            <CardDescription>Completed and rejected jobs are automatically removed from the active queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Winner Page</TableHead>
                    <TableHead>Intent Cluster</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Safety</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-gray-500">No active review jobs for this website.</TableCell>
                    </TableRow>
                  ) : jobs.map(job => (
                    <TableRow key={job.id}>
                      <TableCell><div className="space-y-1"><div className="font-medium text-gray-900">{job.name}</div><div className="text-xs text-gray-500">{job.type}</div></div></TableCell>
                      <TableCell><div className="space-y-1"><div className="font-medium">{job.winnerSlug || "—"}</div><div className="text-xs text-gray-500">Tier {job.winnerTier ?? "—"}</div></div></TableCell>
                      <TableCell>{job.intentCluster || "—"}</TableCell>
                      <TableCell><Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{job.status}</Badge></TableCell>
                      <TableCell><div className="space-y-1 text-xs"><div>{job.requiresConfirmation ? "Requires confirmation" : "No confirmation"}</div><div>{job.redirectRequiredBeforePrune ? "Redirect required" : "No redirect required"}</div><div>{job.destructiveActionAllowed ? "Destructive enabled" : "Safe mode"}</div></div></TableCell>
                      <TableCell className="text-sm text-gray-500">{new Date(job.createdAt).toLocaleString()}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-2"><Button size="sm" className="gap-1" disabled={!!busyId} onClick={() => review(job.id, "approved")}><CheckCircle2 className="h-3.5 w-3.5" />{busyId === job.id + "approved" ? "Working..." : "Approve"}</Button><Button size="sm" variant="outline" className="gap-1" disabled={!!busyId} onClick={() => review(job.id, "needs_changes")}><RefreshCcw className="h-3.5 w-3.5" />Changes</Button><Button size="sm" variant="destructive" className="gap-1" disabled={!!busyId} onClick={() => review(job.id, "rejected")}><XCircle className="h-3.5 w-3.5" />Reject</Button></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
