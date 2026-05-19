import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, ExternalLink, RefreshCcw, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";

interface ReportLink {
  id: string;
  accountId: string;
  clientName: string;
  token: string;
  url: string;
  reportType: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastViewedAt: string | null;
  viewCount: number;
  status: "active" | "expired" | "revoked";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Request failed: ${res.status}`);
  return res.json();
}

function dateOrDash(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function statusBadge(status: string) {
  if (status === "active") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>;
  if (status === "expired") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Expired</Badge>;
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Revoked</Badge>;
}

export default function ReportLinksPage() {
  const [links, setLinks] = useState<ReportLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setLinks(await fetchJson<ReportLink[]>("/api/agency-dashboard/report-links"));
    } catch (e: any) {
      setError(e.message || "Failed to load report links");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: links.length,
    active: links.filter(l => l.status === "active").length,
    expired: links.filter(l => l.status === "expired").length,
    revoked: links.filter(l => l.status === "revoked").length,
    views: links.reduce((sum, l) => sum + (l.viewCount || 0), 0),
  }), [links]);

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setNotice("Report link copied.");
    setTimeout(() => setNotice(null), 4000);
  }

  async function revoke(id: string) {
    setBusyId(id + "revoke");
    setError(null);
    try {
      await postJson(`/api/agency-dashboard/report-links/${id}/revoke`);
      await load();
      setNotice("Report link revoked.");
      setTimeout(() => setNotice(null), 4000);
    } catch (e: any) {
      setError(e.message || "Failed to revoke link");
    } finally {
      setBusyId(null);
    }
  }

  async function regenerate(id: string) {
    setBusyId(id + "regenerate");
    setError(null);
    try {
      const result = await postJson<{ url: string }>(`/api/agency-dashboard/report-links/${id}/regenerate`, { expiresDays: 90 });
      await navigator.clipboard.writeText(result.url);
      await load();
      setNotice("New replacement link copied. Old link revoked.");
      setTimeout(() => setNotice(null), 5000);
    } catch (e: any) {
      setError(e.message || "Failed to regenerate link");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><ShieldAlert className="h-5 w-5" /></div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Report Link Management</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">Manage client-safe monthly report links, track views, copy links, revoke access, and regenerate expired or compromised URLs.</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />{loading ? "Refreshing..." : "Refresh"}</Button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

        <div className="grid gap-4 md:grid-cols-5">
          <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Total Links</p><p className="mt-2 text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Active</p><p className="mt-2 text-2xl font-bold text-green-700">{stats.active}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Expired</p><p className="mt-2 text-2xl font-bold text-yellow-700">{stats.expired}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Revoked</p><p className="mt-2 text-2xl font-bold text-red-700">{stats.revoked}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Total Views</p><p className="mt-2 text-2xl font-bold text-indigo-700">{stats.views}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Shared Report Links</CardTitle>
            <CardDescription>Public links are token-protected. Revoke any link you no longer want accessible.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Last Viewed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {links.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-gray-500">No shared report links created yet.</TableCell></TableRow>
                  ) : links.map(link => (
                    <TableRow key={link.id}>
                      <TableCell>
                        <div className="font-medium text-gray-900">{link.clientName}</div>
                        <div className="mt-1 max-w-[260px] truncate text-xs text-gray-500">{link.url}</div>
                      </TableCell>
                      <TableCell>{statusBadge(link.status)}</TableCell>
                      <TableCell className="text-right font-semibold">{link.viewCount}</TableCell>
                      <TableCell className="text-sm text-gray-500">{dateOrDash(link.createdAt)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{dateOrDash(link.expiresAt)}</TableCell>
                      <TableCell className="text-sm text-gray-500">{dateOrDash(link.lastViewedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")} disabled={link.status !== "active"}><ExternalLink className="h-3.5 w-3.5" />Open</Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => copy(link.url)} disabled={link.status !== "active"}><Copy className="h-3.5 w-3.5" />Copy</Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => regenerate(link.id)} disabled={!!busyId}><RotateCcw className="h-3.5 w-3.5" />{busyId === link.id + "regenerate" ? "..." : "Regenerate"}</Button>
                          <Button size="sm" variant="destructive" className="gap-1" onClick={() => revoke(link.id)} disabled={!!busyId || link.status === "revoked"}><Trash2 className="h-3.5 w-3.5" />{busyId === link.id + "revoke" ? "..." : "Revoke"}</Button>
                        </div>
                      </TableCell>
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
