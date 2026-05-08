import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, Globe, Link2, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";

interface WebsiteOption { id: string; name: string; domain: string; }
type CheckStatus = "pass" | "warning" | "fail";
interface ValidationCheck { key: string; label: string; status: CheckStatus; detail: string; }
interface ValidationResult {
  websiteId: string;
  launchStatus: "ready" | "ready_with_warnings" | "not_ready";
  checkedAt: string;
  summary: {
    publishedPages: number;
    serviceCount: number;
    bankCount: number;
    avgBankScore: number;
    linkCount: number;
    sitemapCount: number;
    failedJobs: number;
    pendingJobs: number;
  };
  checks: ValidationCheck[];
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

function statusBadge(status: CheckStatus) {
  if (status === "pass") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Pass</Badge>;
  if (status === "warning") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Warning</Badge>;
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Fail</Badge>;
}

function statusIcon(status: CheckStatus) {
  if (status === "pass") return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
  return <XCircle className="h-5 w-5 text-red-600" />;
}

function launchBadge(status?: ValidationResult["launchStatus"]) {
  if (status === "ready") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">READY</Badge>;
  if (status === "ready_with_warnings") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">READY WITH WARNINGS</Badge>;
  if (status === "not_ready") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">NOT READY</Badge>;
  return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">NOT CHECKED</Badge>;
}

export default function ProductionValidationPage() {
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWebsite = useMemo(() => websites.find(w => w.id === selectedWebsiteId), [websites, selectedWebsiteId]);
  const counts = useMemo(() => {
    const checks = result?.checks || [];
    return {
      pass: checks.filter(c => c.status === "pass").length,
      warning: checks.filter(c => c.status === "warning").length,
      fail: checks.filter(c => c.status === "fail").length,
    };
  }, [result]);

  async function loadWebsites() {
    const data = await fetchJson<WebsiteOption[]>("/api/websites");
    setWebsites(data);
    if (!selectedWebsiteId && data[0]?.id) setSelectedWebsiteId(data[0].id);
  }

  async function runValidation(websiteId = selectedWebsiteId) {
    if (!websiteId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ValidationResult>(`/api/websites/${websiteId}/production-validation`);
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Validation failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWebsites().catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    setResult(null);
    if (selectedWebsiteId) runValidation(selectedWebsiteId);
  }, [selectedWebsiteId]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-50 p-2 text-green-700"><ClipboardCheck className="h-5 w-5" /></div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Production Validation</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">Done-for-you launch readiness check before scaling, promotion, indexing, or client handoff.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={selectedWebsiteId} onValueChange={setSelectedWebsiteId}>
              <SelectTrigger className="w-full sm:w-[320px]"><SelectValue placeholder="Select website" /></SelectTrigger>
              <SelectContent>{websites.map(w => <SelectItem key={w.id} value={w.id}>{w.name} — {w.domain}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => runValidation()} disabled={!selectedWebsiteId || loading} className="gap-2"><RefreshCcw className="h-4 w-4" />{loading ? "Checking..." : "Run Validation"}</Button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <Card className={result?.launchStatus === "ready" ? "border-green-200" : result?.launchStatus === "not_ready" ? "border-red-200" : "border-yellow-200"}>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-gray-600" />Launch Readiness</CardTitle>
                <CardDescription>{selectedWebsite ? `${selectedWebsite.name} — ${selectedWebsite.domain}` : "Select a website to validate."}</CardDescription>
              </div>
              {launchBadge(result?.launchStatus)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pass</p><p className="mt-1 text-2xl font-bold text-green-700">{counts.pass}</p></div>
              <div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Warnings</p><p className="mt-1 text-2xl font-bold text-yellow-700">{counts.warning}</p></div>
              <div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Failures</p><p className="mt-1 text-2xl font-bold text-red-700">{counts.fail}</p></div>
              <div className="rounded-lg border bg-gray-50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last Checked</p><p className="mt-1 text-sm font-semibold text-gray-900">{result?.checkedAt ? new Date(result.checkedAt).toLocaleString() : "Never"}</p></div>
            </div>
            {result?.launchStatus === "not_ready" && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Do not scale this website yet. Fix failed checks first.</div>}
            {result?.launchStatus === "ready_with_warnings" && <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">Safe for managed beta only. Review warnings before larger rollout.</div>}
            {result?.launchStatus === "ready" && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">Ready for done-for-you launch operations.</div>}
          </CardContent>
        </Card>

        {result && <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="p-4"><Globe className="h-5 w-5 text-blue-600" /><p className="mt-3 text-2xl font-bold">{result.summary.publishedPages}</p><p className="text-xs text-gray-500">Published Pages</p></CardContent></Card>
          <Card><CardContent className="p-4"><Database className="h-5 w-5 text-purple-600" /><p className="mt-3 text-2xl font-bold">{result.summary.bankCount}/{result.summary.serviceCount}</p><p className="text-xs text-gray-500">Bank Rows / Services</p></CardContent></Card>
          <Card><CardContent className="p-4"><Link2 className="h-5 w-5 text-green-600" /><p className="mt-3 text-2xl font-bold">{result.summary.linkCount}</p><p className="text-xs text-gray-500">Internal Links</p></CardContent></Card>
          <Card><CardContent className="p-4"><AlertTriangle className="h-5 w-5 text-red-600" /><p className="mt-3 text-2xl font-bold">{result.summary.failedJobs}</p><p className="text-xs text-gray-500">Failed Jobs</p></CardContent></Card>
        </div>}

        <Card>
          <CardHeader>
            <CardTitle>Validation Checks</CardTitle>
            <CardDescription>Operator checklist for managed client launches.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!result && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">Run validation to see launch readiness checks.</div>}
            {result?.checks.map(check => (
              <div key={check.key} className="flex flex-col gap-3 rounded-lg border bg-white p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  {statusIcon(check.status)}
                  <div>
                    <div className="font-medium text-gray-900">{check.label}</div>
                    <div className="mt-1 text-sm text-gray-500">{check.detail}</div>
                  </div>
                </div>
                <div>{statusBadge(check.status)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
