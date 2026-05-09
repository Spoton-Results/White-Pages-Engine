import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Globe, KeyRound, RefreshCcw, SearchCheck, ShieldCheck, TriangleAlert } from "lucide-react";

export default function SearchConsolePage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><SearchCheck className="h-5 w-5" /></div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Search Console</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">
              Admin-only Google Search Console setup and monitoring area. Agencies should only see read-only reporting status inside their client reports.
            </p>
          </div>
          <Button variant="outline" onClick={() => window.location.href = "/agency-dashboard"}>
            <ExternalLink className="mr-2 h-4 w-4" />Agency Dashboard
          </Button>
        </div>

        <Card className="border-blue-100 bg-gradient-to-br from-slate-950 to-blue-950 text-white">
          <CardContent className="p-6 md:p-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
                <ShieldCheck className="h-3.5 w-3.5" />Internal operations only
              </div>
              <h2 className="mt-5 text-3xl font-bold tracking-tight md:text-5xl">Connect, verify, and monitor client search data.</h2>
              <p className="mt-3 text-sm leading-6 text-blue-100">
                This page is the control room for Search Console. Client and agency screens should show proof, not setup controls.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard title="Google OAuth" value="Not connected" tone="warn" icon="key" />
          <StatusCard title="Client Properties" value="Setup pending" tone="warn" icon="globe" />
          <StatusCard title="Last Sync" value="Not synced" tone="warn" icon="sync" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Admin Setup Checklist</CardTitle>
              <CardDescription>Use this as the operating checklist before exposing Search Console metrics in reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <CheckRow text="Connect agency Google account with Search Console access." />
              <CheckRow text="Map each client website/domain to the correct GSC property." />
              <CheckRow text="Verify sitemap submission and indexing access." />
              <CheckRow text="Sync clicks, impressions, indexed pages, average position, and coverage warnings." />
              <CheckRow text="Expose read-only proof inside Agency Dashboard and monthly reports." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where Search Console Belongs</CardTitle>
              <CardDescription>Separation keeps agencies out of admin controls while still showing proof.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Placement label="Admin Search Console" value="Connect, verify, sync, repair." />
              <Placement label="Client Detail Drawer" value="Show GSC connection health for that client." />
              <Placement label="Agency Dashboard" value="Show summary proof only." />
              <Placement label="Monthly Report" value="Show client-facing growth proof." />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Client Property Table</CardTitle>
            <CardDescription>Placeholder until the live Google Search Console integration is wired.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed p-8 text-center">
              <TriangleAlert className="mx-auto h-8 w-8 text-yellow-600" />
              <p className="mt-3 font-semibold text-gray-900">No Search Console properties synced yet.</p>
              <p className="mt-1 text-sm text-gray-500">Next backend build should add OAuth, property mapping, and per-client GSC sync tables.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatusCard({ title, value, tone, icon }: { title: string; value: string; tone: "ok" | "warn"; icon: "key" | "globe" | "sync" }) {
  const Icon = icon === "key" ? KeyRound : icon === "globe" ? Globe : RefreshCcw;
  return (
    <Card>
      <CardContent className="p-5">
        <Icon className="h-5 w-5 text-blue-600" />
        <p className="mt-4 text-2xl font-bold text-gray-900">{value}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm text-gray-500">{title}</p>
          <Badge className={tone === "ok" ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-yellow-100 text-yellow-900 hover:bg-yellow-100"}>{tone === "ok" ? "Ready" : "Pending"}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CheckRow({ text }: { text: string }) {
  return <div className="rounded-lg border bg-gray-50 p-3 text-gray-700">{text}</div>;
}

function Placement({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 rounded-lg border p-3"><div className="font-medium text-gray-900">{label}</div><div className="max-w-xs text-right text-gray-500">{value}</div></div>;
}
