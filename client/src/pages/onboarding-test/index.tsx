import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  FlaskConical, Plus, Play, RefreshCw, ExternalLink, Trash2,
  CheckCircle2, Clock, AlertCircle, Loader2, ChevronRight,
} from "lucide-react";
import { Link } from "wouter";

const US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const INDUSTRIES = ["Plumbing","HVAC","Roofing","Electrical","Landscaping","Pest Control","Cleaning Services","Auto Repair","Dental","Legal Services","Accounting","Real Estate","Insurance","General Contractor","Painting","Flooring","Windows & Doors","Pool Services","Tree Service","Moving Services"];
const LANDING_DOMAIN = (import.meta as any).env?.VITE_LANDING_DOMAIN || "spotonnexus.com";

const rnd4 = () => Math.floor(1000 + Math.random() * 9000).toString();
const rndSlug = () => Math.random().toString(36).slice(2, 8);

function statusColor(status: string) {
  if (status === "published_live") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (status === "generated_draft_only" || status === "generating") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "ready_for_generation" || status === "ready_for_scoring") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "failed") return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function phaseForStatus(status: string): number {
  if (status === "pending") return 4;
  if (status === "submitted") return 4;
  if (status === "ready_for_scoring") return 5;
  if (status === "ready_for_generation") return 6;
  if (status === "generating") return 6;
  if (status === "generated_draft_only") return 7;
  if (status === "published_live") return 7;
  return 0;
}

const PHASES = [
  { num: 4, label: "Auto-Create", desc: "Create account, website, brand, services & locations" },
  { num: 5, label: "Readiness Score", desc: "Calculate readiness score and gap report" },
  { num: 6, label: "Generate Pages", desc: "Write variation banks and generate draft pages" },
  { num: 7, label: "Launch Governors", desc: "Run wave system, promote eligible pages" },
  { num: 8, label: "Safety Rails", desc: "Check duplicates and warmup page limits" },
  { num: 9, label: "Launch Health", desc: "Calculate launch health score" },
];

function phaseComplete(status: string, phase: number): boolean {
  if (phase === 4) return !["pending", "submitted"].includes(status);
  if (phase === 5) return !["pending", "submitted", "ready_for_scoring"].includes(status);
  if (phase === 6) return ["generated_draft_only", "published_live"].includes(status);
  return false;
}

export default function OnboardingTestPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [runningPhase, setRunningPhase] = useState<number | null>(null);
  const [phaseResults, setPhaseResults] = useState<Record<number, any>>({});
  const [overwritePhase6, setOverwritePhase6] = useState(false);

  const [form, setForm] = useState({
    planType: "local_launch",
    legalName: `Test Business ${rnd4()}`,
    brandName: "",
    domain: `test-${rndSlug()}-demo.com`,
    phone: "(555) 123-4567",
    email: "test@example.com",
    city: "Denver",
    state: "Colorado",
    industry: "Plumbing",
    tagline: "Reliable local service you can trust",
    services: "Plumbing Repair, Drain Cleaning, Water Heater Installation",
    coverageLevel: "statewide",
    cityTier: "medium_and_major",
  });

  const { data: submissions = [], isLoading, isError: listError, error: listErrorMsg } = useQuery({
    queryKey: ["/api/admin/test/submissions"],
    queryFn: () => api.get<any[]>("/api/admin/test/submissions"),
    refetchInterval: selectedId ? 4000 : 8000,
    retry: 1,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorMsg } = useQuery({
    queryKey: ["/api/admin/test/submission", selectedId],
    queryFn: () => api.get<any>(`/api/admin/test/submission/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: 4000,
    retry: 1,
  });

  const { data: pagesData } = useQuery({
    queryKey: ["/api/admin/test/submission/pages", selectedId],
    queryFn: () => api.get<any>(`/api/admin/test/submission/${selectedId}/pages`),
    enabled: !!selectedId && !!(detail?.website),
    refetchInterval: 8000,
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/api/admin/test/create-submission", data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/test/submissions"] });
      setSelectedId(res.submission.id);
      setPhaseResults({});
      setShowForm(false);
      toast({ title: "Test submission created", description: `Token: ${res.submission.token.slice(0, 12)}…` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runPhaseMutation = useMutation({
    mutationFn: ({ phase, submissionId, overwrite }: { phase: number; submissionId: string; overwrite?: boolean }) =>
      api.post(`/api/admin/test/run-phase/${phase}`, { submissionId, ...(overwrite ? { overwrite: true } : {}) }),
    onSuccess: (res: any, vars) => {
      setPhaseResults(prev => ({ ...prev, [vars.phase]: res }));
      setRunningPhase(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/test/submissions"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/test/submission", selectedId] });
      toast({ title: `Phase ${vars.phase} complete` });
    },
    onError: (e: any, vars) => {
      setPhaseResults(prev => ({ ...prev, [vars.phase]: { error: e?.body?.error || e.message } }));
      setRunningPhase(null);
      toast({ title: `Phase ${vars.phase} failed`, description: e?.body?.error || e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/test/submission/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/test/submissions"] });
      if (selectedId) setSelectedId(null);
      toast({ title: "Deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleCreate() {
    const svcList = form.services.split(",").map(s => s.trim()).filter(Boolean);
    createMutation.mutate({
      planType: form.planType,
      business: {
        legal_name: form.legalName,
        brand_name: form.brandName || form.legalName,
        domain: form.domain,
        phone: form.phone,
        email: form.email,
        city: form.city,
        state: form.state,
        industry: form.industry,
        tagline: form.tagline,
      },
      services: svcList,
      coverage: { level: form.coverageLevel, city_tier: form.cityTier, states: [] },
    });
  }

  function runPhase(phase: number) {
    if (!selectedId) return;
    setRunningPhase(phase);
    runPhaseMutation.mutate({ phase, submissionId: selectedId, overwrite: phase === 6 ? overwritePhase6 : undefined });
  }

  const sub = detail?.submission;
  const nextPhase = sub ? phaseForStatus(sub.status) : null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FlaskConical className="size-6 text-violet-500" />
              Onboarding Test Tool
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Simulate the full onboarding pipeline without Stripe. All test submissions use <code className="text-xs bg-muted px-1 py-0.5 rounded">cs_test_manual_…</code> session IDs.
            </p>
          </div>
          <Button onClick={() => { setShowForm(true); setSelectedId(null); }} className="gap-2" data-testid="button-new-test">
            <Plus className="size-4" />
            New Test Submission
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left — submission list */}
          <div className="lg:col-span-1 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">Test Submissions</div>
            {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground p-3"><Loader2 className="size-4 animate-spin" /> Loading…</div>}
            {listError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="font-medium">Failed to load submissions</div>
                <div className="text-xs mt-0.5 font-mono">{(listErrorMsg as any)?.message}</div>
              </div>
            )}
            {!isLoading && !listError && (submissions as any[]).length === 0 && (
              <div className="text-sm text-muted-foreground p-4 border rounded-lg text-center">
                No test submissions yet.<br />Click "New Test Submission" to start.
              </div>
            )}
            {(submissions as any[]).map((s: any) => (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setShowForm(false); setPhaseResults({}); }}
                data-testid={`card-submission-${s.id}`}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === s.id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{(s.formData?.business?.legal_name) || (s.formData?.customer_name) || "Test Submission"}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${statusColor(s.status)}`}>{s.status}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{s.formData?.business?.domain || s.token?.slice(0, 16) + "…"}</div>
                <div className="text-xs text-muted-foreground">{s.planType} · {new Date(s.createdAt).toLocaleString()}</div>
              </button>
            ))}
          </div>

          {/* Right — create form or submission detail */}
          <div className="lg:col-span-2">
            {showForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create Test Submission</CardTitle>
                  <CardDescription>Fill in fake business details. Domain must not already exist.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Plan Type</Label>
                      <Select value={form.planType} onValueChange={v => setForm(p => ({ ...p, planType: v }))}>
                        <SelectTrigger data-testid="select-plan-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local_launch">local_launch</SelectItem>
                          <SelectItem value="growth_bundle">growth_bundle</SelectItem>
                          <SelectItem value="growth_bundle_annual">growth_bundle_annual</SelectItem>
                          <SelectItem value="enterprise">enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Industry</Label>
                      <Select value={form.industry} onValueChange={v => setForm(p => ({ ...p, industry: v }))}>
                        <SelectTrigger data-testid="select-industry"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Business Legal Name</Label>
                      <Input data-testid="input-legal-name" value={form.legalName} onChange={e => setForm(p => ({ ...p, legalName: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Brand Name (optional)</Label>
                      <Input data-testid="input-brand-name" placeholder={form.legalName} value={form.brandName} onChange={e => setForm(p => ({ ...p, brandName: e.target.value }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Domain</Label>
                      <Input data-testid="input-domain" value={form.domain} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone</Label>
                      <Input data-testid="input-phone" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Email</Label>
                      <Input data-testid="input-email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Tagline</Label>
                      <Input data-testid="input-tagline" value={form.tagline} onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>City</Label>
                      <Input data-testid="input-city" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>State</Label>
                      <Select value={form.state} onValueChange={v => setForm(p => ({ ...p, state: v }))}>
                        <SelectTrigger data-testid="select-state"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Services (comma-separated)</Label>
                    <Input data-testid="input-services" value={form.services} onChange={e => setForm(p => ({ ...p, services: e.target.value }))} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Coverage Level</Label>
                      <Select value={form.coverageLevel} onValueChange={v => setForm(p => ({ ...p, coverageLevel: v }))}>
                        <SelectTrigger data-testid="select-coverage"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regional">regional</SelectItem>
                          <SelectItem value="statewide">statewide</SelectItem>
                          <SelectItem value="multi_state">multi_state</SelectItem>
                          <SelectItem value="national">national</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>City Tier</Label>
                      <Select value={form.cityTier} onValueChange={v => setForm(p => ({ ...p, cityTier: v }))}>
                        <SelectTrigger data-testid="select-city-tier"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="major">major</SelectItem>
                          <SelectItem value="medium_and_major">medium_and_major</SelectItem>
                          <SelectItem value="all">all</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-submission" className="gap-2">
                      {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                      Create Test Submission
                    </Button>
                    <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedId && !showForm && (
              detailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-6"><Loader2 className="size-4 animate-spin" /> Loading…</div>
              ) : detailError ? (
                <div className="p-6 border border-red-200 bg-red-50 rounded-xl space-y-2">
                  <div className="text-sm font-semibold text-red-700">Failed to load submission</div>
                  <div className="text-xs font-mono text-red-600 bg-red-100 rounded p-2 break-all">{(detailErrorMsg as any)?.message || "Unknown error"}</div>
                  <div className="text-xs text-muted-foreground">Submission ID: <code>{selectedId}</code></div>
                  <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/test/submission", selectedId] })}>
                    Retry
                  </Button>
                </div>
              ) : !detail ? (
                <div className="text-sm text-muted-foreground p-6">No data returned. <button className="underline" onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/test/submission", selectedId] })}>Retry</button></div>
              ) : (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{sub?.formData?.business?.legal_name || "Test Submission"}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${statusColor(sub?.status)}`}>{sub?.status}</span>
                        <span className="text-xs text-muted-foreground">{sub?.planType}</span>
                        <span className="text-xs text-muted-foreground font-mono">{sub?.token?.slice(0, 16)}…</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/test/submission", selectedId] })} className="gap-1.5">
                        <RefreshCw className="size-3.5" />
                        Refresh
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(selectedId!)} disabled={deleteMutation.isPending}>
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Quick links */}
                  <div className="flex flex-wrap gap-2">
                    {detail?.account && (
                      <Link href={`/accounts`}>
                        <a className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-muted hover:bg-muted/70 border" data-testid="link-view-account">
                          <ExternalLink className="size-3" /> View Account
                        </a>
                      </Link>
                    )}
                    {detail?.website && (
                      <Link href={`/websites`}>
                        <a className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-muted hover:bg-muted/70 border" data-testid="link-view-website">
                          <ExternalLink className="size-3" /> View Website
                        </a>
                      </Link>
                    )}
                    {detail?.website && (
                      <Link href={`/published`}>
                        <a className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-muted hover:bg-muted/70 border" data-testid="link-view-pages">
                          <ExternalLink className="size-3" /> View Pages
                        </a>
                      </Link>
                    )}
                    {sub?.token && (
                      <a href={`https://${LANDING_DOMAIN}/dashboard/${sub.token}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200" data-testid="link-customer-dashboard">
                        <ExternalLink className="size-3" /> Customer Dashboard ↗
                      </a>
                    )}
                  </div>

                  {/* Page stats */}
                  {detail?.pageStats && (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Total Pages", value: detail.pageStats.total },
                        { label: "Published", value: detail.pageStats.published },
                        { label: "Draft", value: detail.pageStats.draft },
                      ].map(s => (
                        <div key={s.label} className="border rounded-lg p-3 text-center bg-card">
                          <div className="text-xl font-bold">{s.value ?? 0}</div>
                          <div className="text-xs text-muted-foreground">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tier breakdown + sample pages */}
                  {pagesData?.stats && pagesData.stats.total > 0 && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Tier 1", value: pagesData.stats.tier1, color: "text-violet-600" },
                          { label: "Tier 2", value: pagesData.stats.tier2, color: "text-blue-600" },
                          { label: "Tier 3", value: pagesData.stats.tier3, color: "text-slate-500" },
                          { label: "Avg Score", value: pagesData.stats.averageScore, color: "text-emerald-600" },
                        ].map(s => (
                          <div key={s.label} className="border rounded-lg p-2 text-center bg-card">
                            <div className={`text-lg font-bold ${s.color}`}>{s.value ?? 0}</div>
                            <div className="text-[11px] text-muted-foreground">{s.label}</div>
                          </div>
                        ))}
                      </div>
                      {pagesData.samplePages?.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Sample Pages (first 20)</div>
                          <div className="border rounded-lg overflow-auto max-h-44">
                            <table className="w-full text-xs">
                              <thead className="bg-muted sticky top-0">
                                <tr>
                                  <th className="text-left p-2 font-medium">Slug</th>
                                  <th className="p-2 font-medium text-center">Tier</th>
                                  <th className="p-2 font-medium text-center">Score</th>
                                  <th className="p-2 font-medium text-center">Wave</th>
                                  <th className="p-2 font-medium text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagesData.samplePages.map((p: any, i: number) => (
                                  <tr key={i} className="border-t hover:bg-muted/30">
                                    <td className="p-2 font-mono truncate max-w-[180px]">{p.slug}</td>
                                    <td className="p-2 text-center">{p.tier ?? "—"}</td>
                                    <td className="p-2 text-center">{p.qualityScore ?? "—"}</td>
                                    <td className="p-2 text-center">{p.publishWave ?? "—"}</td>
                                    <td className="p-2 text-center">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.isDraft ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                        {p.isDraft ? "draft" : "live"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Phase runner */}
                  <div>
                    <div className="text-sm font-semibold mb-3">Pipeline Phases</div>
                    <div className="space-y-2">
                      {PHASES.map((ph) => {
                        const done = phaseComplete(sub?.status, ph.num);
                        const isNext = nextPhase === ph.num;
                        const isRunning = runningPhase === ph.num;
                        const result = phaseResults[ph.num];
                        const locked = !done && !isNext;
                        return (
                          <div key={ph.num} className={`rounded-lg border p-3 transition-colors ${done ? "bg-emerald-50 border-emerald-200" : isNext ? "bg-primary/5 border-primary" : "bg-card border-border opacity-60"}`} data-testid={`phase-row-${ph.num}`}>
                            <div className="flex items-center gap-3">
                              <div className={`size-7 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${done ? "bg-emerald-500 text-white" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                {done ? <CheckCircle2 className="size-4" /> : isRunning ? <Loader2 className="size-4 animate-spin" /> : ph.num}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium">Phase {ph.num}: {ph.label}</div>
                                <div className="text-xs text-muted-foreground">{ph.desc}</div>
                              </div>
                              {ph.num === 6 && (
                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0" data-testid="label-overwrite-phase6">
                                  <input
                                    type="checkbox"
                                    checked={overwritePhase6}
                                    onChange={e => setOverwritePhase6(e.target.checked)}
                                    disabled={isRunning || runningPhase !== null}
                                    data-testid="checkbox-overwrite-phase6"
                                    className="accent-primary"
                                  />
                                  Overwrite
                                </label>
                              )}
                              <Button
                                size="sm"
                                variant={done ? "outline" : isNext ? "default" : "outline"}
                                disabled={locked || isRunning || runningPhase !== null}
                                onClick={() => runPhase(ph.num)}
                                data-testid={`button-run-phase-${ph.num}`}
                                className="gap-1.5 shrink-0"
                              >
                                {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : done ? <RefreshCw className="size-3.5" /> : <Play className="size-3.5" />}
                                {done ? "Re-run" : isRunning ? "Running…" : "Run"}
                              </Button>
                            </div>
                            {result && (
                              <div className={`mt-2 ml-10 text-xs rounded p-2 font-mono whitespace-pre-wrap ${result.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-muted text-muted-foreground"}`}>
                                {result.error ? `Error: ${result.error}` : JSON.stringify(result, null, 2).slice(0, 600)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <Separator />

                  {/* Submission details */}
                  <div>
                    <div className="text-sm font-semibold mb-3">Submission Record</div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {[
                        { label: "Readiness Score", value: sub?.readinessScore ?? "—" },
                        { label: "Brand Input Score", value: sub?.brandInputScore ?? "—" },
                        { label: "Submitted At", value: sub?.submittedAt ? new Date(sub.submittedAt).toLocaleString() : "—" },
                        { label: "Completed At", value: sub?.completedAt ? new Date(sub.completedAt).toLocaleString() : "—" },
                      ].map(f => (
                        <div key={f.label} className="border rounded p-2.5 bg-card">
                          <div className="text-xs text-muted-foreground">{f.label}</div>
                          <div className="text-sm font-medium mt-0.5">{String(f.value)}</div>
                        </div>
                      ))}
                    </div>

                    {sub?.readinessResult && (
                      <div className="mb-3">
                        <div className="text-xs font-medium text-muted-foreground mb-1">Gap Report</div>
                        <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">{JSON.stringify(sub.readinessResult, null, 2)}</pre>
                      </div>
                    )}

                    <div className="text-xs font-medium text-muted-foreground mb-1">Form Data</div>
                    <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">{JSON.stringify(sub?.formData, null, 2)}</pre>
                  </div>
                </div>
              )
            )}

            {!selectedId && !showForm && (
              <div className="flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed rounded-xl text-center">
                <FlaskConical className="size-10 text-muted-foreground/40" />
                <div>
                  <div className="font-medium text-muted-foreground">No submission selected</div>
                  <div className="text-sm text-muted-foreground/70 mt-1">Create a new test submission or select one from the list</div>
                </div>
                <Button onClick={() => setShowForm(true)} className="gap-2">
                  <Plus className="size-4" /> New Test Submission
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
