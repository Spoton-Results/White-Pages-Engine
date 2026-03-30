import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Factory, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function IndustriesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideAccount, setOverrideAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const selectedAccount = overrideAccount || (accounts as any[])[0]?.id || "";

  const { data: industries = [], isLoading } = useQuery({
    queryKey: ["/api/industries", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/industries`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/industries`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/industries"] });
      setShowCreate(false);
      reset();
      toast({ title: "Industry created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/industries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/industries"] });
      toast({ title: "Industry deleted" });
    },
  });

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
        </div>

        {!selectedAccount ? (
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Industry</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Industry Name</Label>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
