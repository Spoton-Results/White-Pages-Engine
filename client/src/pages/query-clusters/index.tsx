import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Trash2, Sparkles, Zap, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function QueryClustersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<any>();
  const [showBulkCluster, setShowBulkCluster] = useState(false);
  const [bulkClusterSvcs, setBulkClusterSvcs] = useState<Set<string>>(new Set());
  const [bulkSuggestions, setBulkSuggestions] = useState<Array<{ service: string; clusters: any[] }> | null>(null);
  const [approvedClusters, setApprovedClusters] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const selectedAccount = overrideAccount || (accounts as any[])[0]?.id || "";

  const { data: clusters = [], isLoading } = useQuery({
    queryKey: ["/api/query-clusters", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/query-clusters`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const { data: services = [] } = useQuery({
    queryKey: ["/api/services", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/services`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/query-clusters`, {
      ...data,
      secondaryKeywords: data.secondaryKeywords ? data.secondaryKeywords.split(",").map((k: string) => k.trim()) : [],
      searchVolume: parseInt(data.searchVolume) || null,
      difficulty: parseInt(data.difficulty) || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/query-clusters"] });
      setShowCreate(false);
      reset();
      toast({ title: "Query cluster created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/query-clusters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/query-clusters"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const aiGenerate = useMutation({
    mutationFn: () => api.post<{ inserted: number; clusters: any[] }>(`/api/accounts/${selectedAccount}/query-clusters/ai-generate`, {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/query-clusters"] });
      toast({ title: `${data.inserted} clusters generated`, description: "AI-generated query clusters have been added." });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const intentColors: Record<string, string> = {
    transactional: "bg-emerald-500/10 text-emerald-600",
    informational: "bg-blue-500/10 text-blue-600",
    local: "bg-violet-500/10 text-violet-600",
    navigational: "bg-amber-500/10 text-amber-600",
  };

  const generateBulkClusters = async () => {
    setBulkGenerating(true);
    try {
      const svcNames = [...bulkClusterSvcs];
      const result = await api.post<any>(`/api/accounts/${selectedAccount}/query-clusters/bulk-suggest`, { services: svcNames });
      const allKeys = new Set<string>();
      result.suggestions.forEach((g: any) => g.clusters.forEach((c: any) => allKeys.add(c.primaryKeyword)));
      setApprovedClusters(allKeys);
      setBulkSuggestions(result.suggestions);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally { setBulkGenerating(false); }
  };

  const saveBulkClusters = async () => {
    const allClusters: any[] = [];
    (bulkSuggestions || []).forEach(g => g.clusters.forEach(c => { if (approvedClusters.has(c.primaryKeyword)) allClusters.push(c); }));
    try {
      const result = await api.post<any>(`/api/accounts/${selectedAccount}/query-clusters/bulk-save`, { clusters: allClusters });
      qc.invalidateQueries({ queryKey: ["/api/query-clusters"] });
      toast({ title: `Saved ${result.saved} cluster(s)` });
      setShowBulkCluster(false); setBulkSuggestions(null); setBulkClusterSvcs(new Set()); setApprovedClusters(new Set());
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Query Clusters</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Organize keyword groups by search intent for targeted content.</p>
          </div>
          {selectedAccount && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setShowBulkCluster(true)}
                data-testid="button-bulk-generate-clusters"
              >
                <Zap className="size-4" />Bulk Generate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => aiGenerate.mutate()}
                disabled={aiGenerate.isPending}
                data-testid="button-ai-generate-clusters"
              >
                <Sparkles className="size-4" />
                {aiGenerate.isPending ? "Generating…" : "Generate with AI"}
              </Button>
              <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)} data-testid="button-add-cluster">
                <Plus className="size-4" />Add Cluster
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setOverrideAccount} value={selectedAccount}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAccount && <span className="text-sm text-muted-foreground">{(clusters as any[]).length} clusters</span>}
        </div>

        {!selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Search className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage query clusters</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cluster Name</TableHead>
                  <TableHead>Primary Keyword</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Search Volume</TableHead>
                  <TableHead className="text-right">Difficulty</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : (clusters as any[]).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No query clusters yet.</TableCell>
                  </TableRow>
                ) : (clusters as any[]).map((cluster: any) => (
                  <TableRow key={cluster.id}>
                    <TableCell className="font-medium">{cluster.name}</TableCell>
                    <TableCell className="text-sm">{cluster.primaryKeyword}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs capitalize ${intentColors[cluster.intentType] || ""}`}>
                        {cluster.intentType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{cluster.searchVolume?.toLocaleString() || "—"}</TableCell>
                    <TableCell className="text-right text-sm">{cluster.difficulty != null ? `${cluster.difficulty}/100` : "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(cluster.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Fix 3 — Bulk Generate Clusters Dialog */}
      <Dialog open={showBulkCluster} onOpenChange={v => { if (!v) { setShowBulkCluster(false); setBulkSuggestions(null); setBulkClusterSvcs(new Set()); setApprovedClusters(new Set()); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle>Bulk Generate Query Clusters</DialogTitle></DialogHeader>
          {!bulkSuggestions ? (
            <div className="flex flex-col gap-4 py-2">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>Select Services (Claude generates 10–15 clusters per service)</Label>
                  <button className="text-xs text-primary"
                    onClick={() => setBulkClusterSvcs(bulkClusterSvcs.size === (services as any[]).length ? new Set() : new Set((services as any[]).map((s: any) => s.name)))}>
                    {bulkClusterSvcs.size === (services as any[]).length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="border rounded-lg p-2 max-h-52 overflow-auto flex flex-col gap-1">
                  {(services as any[]).length === 0 ? (
                    <span className="text-sm text-muted-foreground p-2">No services found</span>
                  ) : (services as any[]).map((s: any) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={bulkClusterSvcs.has(s.name)}
                        onChange={() => { const n = new Set(bulkClusterSvcs); if (n.has(s.name)) n.delete(s.name); else n.add(s.name); setBulkClusterSvcs(n); }} />
                      <span className="text-sm">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowBulkCluster(false)}>Cancel</Button>
                <Button onClick={generateBulkClusters} disabled={bulkClusterSvcs.size === 0 || bulkGenerating} data-testid="btn-bulk-cluster-generate">
                  <Sparkles className="size-4 mr-2" />
                  {bulkGenerating ? `Generating for ${bulkClusterSvcs.size} service(s)…` : `Generate for ${bulkClusterSvcs.size} Service${bulkClusterSvcs.size !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-2">
              <div className="text-sm text-muted-foreground bg-muted/40 rounded p-2">
                Review and approve clusters to save. <strong>{approvedClusters.size}</strong> approved of {(bulkSuggestions || []).reduce((s, g) => s + g.clusters.length, 0)} generated.
              </div>
              <div className="flex flex-col gap-4 max-h-96 overflow-auto">
                {(bulkSuggestions || []).map(group => (
                  <div key={group.service}>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 sticky top-0 bg-background py-1">{group.service}</div>
                    <div className="flex flex-col gap-1">
                      {group.clusters.map((c: any) => (
                        <label key={c.primaryKeyword} className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1.5 border border-transparent has-[:checked]:border-primary/20 has-[:checked]:bg-primary/5">
                          <input type="checkbox" className="mt-0.5" checked={approvedClusters.has(c.primaryKeyword)}
                            onChange={() => { const n = new Set(approvedClusters); if (n.has(c.primaryKeyword)) n.delete(c.primaryKeyword); else n.add(c.primaryKeyword); setApprovedClusters(n); }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.primaryKeyword}</div>
                            <div className="flex gap-2 mt-0.5">
                              <Badge variant="secondary" className={`text-xs capitalize ${intentColors[c.intentType] || ""}`}>{c.intentType}</Badge>
                              {c.searchVolume && <span className="text-xs text-muted-foreground">~{c.searchVolume.toLocaleString()}/mo</span>}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkSuggestions(null)}>← Back</Button>
                <Button onClick={saveBulkClusters} disabled={approvedClusters.size === 0} data-testid="btn-bulk-cluster-save">
                  <Check className="size-4 mr-2" />Save {approvedClusters.size} Cluster{approvedClusters.size !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Query Cluster</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Cluster Name</Label>
              <Input placeholder="Emergency Plumber Intent" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Intent Type</Label>
              <Select onValueChange={v => setValue("intentType", v)}>
                <SelectTrigger><SelectValue placeholder="Select intent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transactional">Transactional</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="informational">Informational</SelectItem>
                  <SelectItem value="navigational">Navigational</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Primary Keyword</Label>
              <Input placeholder="emergency plumber near me" {...register("primaryKeyword", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Secondary Keywords (comma separated)</Label>
              <Input placeholder="24 hour plumber, plumber open now" {...register("secondaryKeywords")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Search Volume</Label>
                <Input type="number" placeholder="8100" {...register("searchVolume")} />
              </div>
              <div className="space-y-1.5">
                <Label>Difficulty (0-100)</Label>
                <Input type="number" placeholder="45" {...register("difficulty")} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
