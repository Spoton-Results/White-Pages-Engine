import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Factory, Trash2, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { useAccountContext } from "@/contexts/account-context";
import { AccountPicker } from "@/components/shared/AccountPicker";

export default function IndustriesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { selectedAccountId, accountsLoading } = useAccountContext();
  const selectedAccount = selectedAccountId;
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue, watch } = useForm<any>();

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ description: string; relatedServices: string[] } | null>(null);

  const industryName = watch("name");

  const { data: industries = [], isLoading } = useQuery({
    queryKey: ["/api/industries", selectedAccount],
    queryFn: () =>
      selectedAccount
        ? api.get<any[]>(`/api/accounts/${selectedAccount}/industries`)
        : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const create = useMutation({
    mutationFn: (data: any) =>
      api.post(`/api/accounts/${selectedAccount}/industries`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/industries", selectedAccount] });
      setShowCreate(false);
      reset();
      setAiResult(null);
      toast({ title: "Industry created" });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/industries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/industries", selectedAccount] });
      toast({ title: "Industry deleted" });
    },
  });

  async function handleAiSuggest() {
    if (!selectedAccount) {
      toast({ title: "Select an account first", variant: "destructive" });
      return;
    }
    if (!industryName?.trim()) {
      toast({ title: "Enter industry name first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const result = await api.post<any>(
        `/api/accounts/${selectedAccount}/industries/ai-suggest`,
        { name: industryName }
      );
      setAiResult(result);
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiResult() {
    if (!aiResult) return;
    setValue("description", aiResult.description);
    setAiResult(null);
    toast({ title: "Description filled from AI" });
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Industries</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Classify content by industry vertical.</p>
          </div>
          {selectedAccount && (
            <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />Add Industry
            </Button>
          )}
        </div>

        <AccountPicker countLabel={selectedAccount ? `${(industries as any[]).length} industries` : undefined} />

        {accountsLoading ? (
          <div className="bg-card rounded-lg border p-4">
            <Skeleton className="h-10 w-64" />
          </div>
        ) : !selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Factory className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage industries</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Industry</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>NAICS Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : (industries as any[]).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No industries yet.</TableCell>
                  </TableRow>
                ) : (industries as any[]).map((ind: any) => (
                  <TableRow key={ind.id}>
                    <TableCell className="font-medium">{ind.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{ind.slug}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{ind.naicsCode || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs truncate max-w-[200px]">{ind.description || "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => confirm("Delete industry?") && remove.mutate(ind.id)}>
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

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) { reset(); setAiResult(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Industry</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Industry Name</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs text-violet-600 border-violet-300 hover:bg-violet-50"
                  disabled={aiLoading || !industryName?.trim() || !selectedAccount}
                  onClick={handleAiSuggest}
                  data-testid="button-industry-ai-suggest"
                >
                  {aiLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {aiLoading ? "Generating…" : "AI Fill Description"}
                </Button>
              </div>
              <Input placeholder="Plumbing" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input placeholder="plumbing" {...register("slug", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>NAICS Code</Label>
              <Input placeholder="238220" {...register("naicsCode")} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} {...register("description")} />
            </div>

            {aiResult && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-violet-700 text-xs font-semibold">
                  <CheckCircle2 className="size-3.5" />AI Suggested
                </div>
                <p className="text-xs text-muted-foreground">{aiResult.description}</p>
                {aiResult.relatedServices?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-xs text-violet-700 font-medium mr-1">Related services:</span>
                    {aiResult.relatedServices.map((s: string) => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
                <Button type="button" size="sm" className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={applyAiResult}>
                  <CheckCircle2 className="size-3.5" />Apply Description
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !selectedAccount}>Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
