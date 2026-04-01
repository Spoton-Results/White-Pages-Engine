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
import { Plus, Search, Trash2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function QueryClustersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<any>();

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
