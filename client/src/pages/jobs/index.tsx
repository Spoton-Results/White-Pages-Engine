import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Play, Square, Plus, RefreshCw, Zap, CheckCircle, XCircle, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function JobsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const websiteIdFilter = params.get("websiteId");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>({ locationIds: [], serviceIds: [], industryIds: [] });

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["/api/jobs", websiteIdFilter],
    queryFn: () => api.get<any[]>("/api/jobs"),
    refetchInterval: 5000,
  });

  const { data: systemStatus } = useQuery({
    queryKey: ["/api/system/status"],
    queryFn: () => api.get<any>("/api/system/status"),
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const selectedAccountId = form.accountId;
  const { data: blueprints = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "blueprints"],
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/blueprints`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "locations"],
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/locations`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["/api/accounts", selectedAccountId, "services"],
    queryFn: () => selectedAccountId ? api.get<any[]>(`/api/accounts/${selectedAccountId}/services`) : Promise.resolve([]),
    enabled: !!selectedAccountId,
  });

  const createJob = useMutation({
    mutationFn: (data: any) => api.post("/api/jobs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setShowCreate(false);
      setForm({ locationIds: [], serviceIds: [], industryIds: [] });
      toast({ title: "Generation job started", description: "Pages are being generated in the background." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/api/jobs/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job cancelled" });
    },
  });

  const toggleSelection = (field: string, id: string) => {
    setForm((prev: any) => {
      const arr = prev[field] || [];
      return { ...prev, [field]: arr.includes(id) ? arr.filter((x: string) => x !== id) : [...arr, id] };
    });
  };

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="size-4 text-emerald-500" />;
    if (status === "failed") return <XCircle className="size-4 text-destructive" />;
    if (status === "running") return <RefreshCw className="size-4 text-blue-500 animate-spin" />;
    if (status === "cancelled") return <Square className="size-4 text-muted-foreground" />;
    return <Clock className="size-4 text-amber-500" />;
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Generation Jobs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Create and monitor AI page generation workflows.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/jobs"] })}>
              <RefreshCw className="size-4 mr-2" />Refresh
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />New Job
            </Button>
          </div>
        </div>

        {!systemStatus?.claudeConfigured && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              ANTHROPIC_API_KEY is not configured. Generation jobs require this key to work. 
              Add it in your environment secrets.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Zap className="size-12 text-muted-foreground/30" />
              <div className="text-center">
                <h3 className="font-semibold">No generation jobs yet</h3>
                <p className="text-muted-foreground text-sm mt-1">Create a job to start generating white-pages content with Claude AI.</p>
              </div>
              <Button onClick={() => setShowCreate(true)}>Create First Job</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {jobs.map((job: any) => (
              <Card key={job.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5">{statusIcon(job.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-sm truncate">{job.name}</h3>
                        <Badge variant="outline" className={`text-xs shrink-0 ${
                          job.status === "completed" ? "border-emerald-200 text-emerald-700" :
                          job.status === "running" ? "border-blue-200 text-blue-700" :
                          job.status === "failed" ? "border-red-200 text-red-700" : ""
                        }`}>{job.status}</Badge>
                      </div>

                      {(job.totalPages > 0) && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{job.processedPages} / {job.totalPages} pages processed</span>
                            <span className="text-emerald-600">{job.passedPages} passed</span>
                            {job.failedPages > 0 && <span className="text-destructive">{job.failedPages} failed</span>}
                          </div>
                          <Progress value={job.totalPages > 0 ? (job.processedPages / job.totalPages) * 100 : 0} className="h-1.5" />
                        </div>
                      )}

                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {job.createdAt && <span>Created {formatDistanceToNow(new Date(job.createdAt))} ago</span>}
                        {job.completedAt && <span>Completed {formatDistanceToNow(new Date(job.completedAt))} ago</span>}
                      </div>
                    </div>

                    {job.status === "running" && (
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => cancel.mutate(job.id)}>
                        <Square className="size-3 mr-1" />Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Generation Job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select onValueChange={v => setForm((p: any) => ({ ...p, accountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Website</Label>
              <Select onValueChange={v => setForm((p: any) => ({ ...p, websiteId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select website" /></SelectTrigger>
                <SelectContent>
                  {websites.filter((w: any) => !selectedAccountId || w.accountId === selectedAccountId).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Blueprint</Label>
              <Select onValueChange={v => setForm((p: any) => ({ ...p, blueprintId: v }))} disabled={!selectedAccountId}>
                <SelectTrigger><SelectValue placeholder="Select blueprint" /></SelectTrigger>
                <SelectContent>
                  {blueprints.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Job Name</Label>
              <Input placeholder="e.g. Atlanta Plumbing Q1" onChange={e => setForm((p: any) => ({ ...p, jobName: e.target.value }))} />
            </div>

            {locations.length > 0 && (
              <div className="space-y-1.5">
                <Label>Locations ({form.locationIds?.length || 0} selected)</Label>
                <div className="border rounded-md p-2 max-h-32 overflow-y-auto space-y-1">
                  {locations.map((loc: any) => (
                    <label key={loc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded">
                      <input type="checkbox" checked={form.locationIds?.includes(loc.id)} onChange={() => toggleSelection("locationIds", loc.id)} />
                      {loc.name}, {loc.stateCode}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {services.length > 0 && (
              <div className="space-y-1.5">
                <Label>Services ({form.serviceIds?.length || 0} selected)</Label>
                <div className="border rounded-md p-2 max-h-28 overflow-y-auto space-y-1">
                  {services.map((svc: any) => (
                    <label key={svc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded">
                      <input type="checkbox" checked={form.serviceIds?.includes(svc.id)} onChange={() => toggleSelection("serviceIds", svc.id)} />
                      {svc.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              The job will generate one page per location × service combination using Claude AI. 
              Each page goes through two passes and rule-based QA before entering draft review.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createJob.mutate(form)}
              disabled={createJob.isPending || !form.accountId || !form.websiteId || !form.blueprintId}
            >
              {createJob.isPending ? "Starting..." : "Start Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
