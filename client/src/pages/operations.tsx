import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, Database, RefreshCcw, ShieldCheck, Wrench, XCircle } from "lucide-react";

type CheckStatus = "ok" | "warning" | "critical";

type IntegrityCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  count: number;
  description: string;
  repairAction?: string;
};

type IntegrityScan = {
  scannedAt: string;
  healthScore: number;
  summary: {
    accounts: number;
    websites: number;
    publishedPages: number;
    jobs30d: number;
    criticalCount: number;
    warningCount: number;
  };
  checks: IntegrityCheck[];
};

const emptyScan: IntegrityScan = {
  scannedAt: "",
  healthScore: 0,
  summary: { accounts: 0, websites: 0, publishedPages: 0, jobs30d: 0, criticalCount: 0, warningCount: 0 },
  checks: [],
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...(init || {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

function fmt(n?: number) {
  return Math.round(n || 0).toLocaleString();
}

function statusBadge(status: CheckStatus) {
  if (status === "ok") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>;
  if (status === "critical") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Critical</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Warning</Badge>;
}

function statusIcon(status: CheckStatus) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "critical") return <XCircle className="h-4 w-4 text-red-600" />;
  return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
}

export default function OperationsPage() {
  const [scan, setScan] = useState<IntegrityScan>(emptyScan);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setScan(await fetchJson<IntegrityScan>("/api/system-integrity/scan"));
    } catch (e: any) {
      setError(e.message || "Failed to load operations scan");
    } finally {
      setLoading(false);
    }
  }

  async function repair(action: string) {
    setRepairing(action);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<{ ok: boolean; repaired: number; scan: IntegrityScan }>(`/api/system-integrity/repair/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setScan(data.scan);
      setNotice(`Repair complete: ${fmt(data.repaired)} row(s) affected.`);
      setTimeout(() => setNotice(null), 5000);
    } catch (e: any) {
      setError(e.message || "Repair failed");
    } finally {
      setRepairing(null);
    }
  }

  useEffect(() => { load(); }, []);

  const statusText = useMemo(() => {
    if (scan.healthScore >= 90) return "Strong";
    if (scan.healthScore >= 70) return "Stable";
    if (scan.healthScore >= 50) return "Warning";
    return "Critical";
  }, [scan.healthScore]);

  const prioritizedChecks = useMemo(() => {
    const rank: Record<CheckStatus, number> = { critical: 0, warning: 1, ok: 2 };
    return [...scan.checks].sort((a, b) => rank[a.status] - rank[b.status] || b.count - a.count);
  }, [scan.checks]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><ShieldCheck className="h-5 w-5" /></div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Operations Layer</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">One compact control plane for platform health, integrity, jobs, repair actions, and client risk. No dashboard sprawl.</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />{loading ? "Scanning..." : "Run Scan"}</Button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Operational Health</p>
                  <p className="mt-2 text-4xl font-bold text-gray-900">{fmt(scan.healthScore)}</p>
                  <p className="mt-1 text-sm text-gray-500">{statusText}</p>
                </div>
                <Activity className="h-8 w-8 text-indigo-600" />
              </div>
              <Progress value={scan.healthScore} className="mt-4" />
            </CardContent>
          </Card>
          <Card><CardContent className="p-5"><Database className="h-5 w-5 text-blue-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.accounts)}</p><p className="text-sm text-gray-500">Accounts</p></CardContent></Card>
          <Card><CardContent className="p-5"><Database className="h-5 w-5 text-purple-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.websites)}</p><p className="text-sm text-gray-500">Websites</p></CardContent></Card>
          <Card><CardContent className="p-5"><Database className="h-5 w-5 text-green-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.publishedPages)}</p><p className="text-sm text-gray-500">Published Pages</p></CardContent></Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="p-5"><AlertTriangle className="h-5 w-5 text-red-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.criticalCount)}</p><p className="text-sm text-gray-500">Critical Issues</p></CardContent></Card>
          <Card><CardContent className="p-5"><AlertTriangle className="h-5 w-5 text-yellow-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.warningCount)}</p><p className="text-sm text-gray-500">Warnings</p></CardContent></Card>
          <Card><CardContent className="p-5"><Wrench className="h-5 w-5 text-slate-600" /><p className="mt-4 text-3xl font-bold">{fmt(scan.summary.jobs30d)}</p><p className="text-sm text-gray-500">Jobs Last 30 Days</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Integrity Checks</CardTitle>
            <CardDescription>Only operational checks that reduce support burden, improve reliability, or protect publish safety are shown here.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead className="text-right">Affected</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prioritizedChecks.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-gray-500">No scan data yet.</TableCell></TableRow>
                  ) : prioritizedChecks.map((check) => (
                    <TableRow key={check.key}>
                      <TableCell><div className="flex items-center gap-2">{statusIcon(check.status)}{statusBadge(check.status)}</div></TableCell>
                      <TableCell><div className="font-medium text-gray-900">{check.label}</div><div className="mt-1 text-xs text-gray-500">{check.key}</div></TableCell>
                      <TableCell className="text-right font-semibold">{fmt(check.count)}</TableCell>
                      <TableCell className="max-w-xl text-sm text-gray-600">{check.description}</TableCell>
                      <TableCell className="text-right">
                        {check.repairAction ? (
                          <Button size="sm" variant={check.status === "ok" ? "outline" : "default"} disabled={repairing === check.repairAction || loading} onClick={() => repair(check.repairAction!)} className="gap-2">
                            <Wrench className="h-3.5 w-3.5" />{repairing === check.repairAction ? "Repairing..." : "Repair"}
                          </Button>
                        ) : <span className="text-xs text-gray-400">Monitor</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 text-xs text-gray-500">Last scanned: {scan.scannedAt ? new Date(scan.scannedAt).toLocaleString() : "Not scanned yet"}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-slate-50">
          <CardHeader>
            <CardTitle className="text-base">What this page intentionally does not include</CardTitle>
            <CardDescription>No vanity analytics, no real-time noise, no complex charts, no extra modules. This page exists to keep Nexus reliable and repairable.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </DashboardLayout>
  );
}
