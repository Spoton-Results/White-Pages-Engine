import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Layers, Edit, Trash2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function BlueprintsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const { data: blueprints = [], isLoading } = useQuery({
    queryKey: ["/api/blueprints", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/blueprints`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/blueprints`, {
      ...data,
      sections: [
        { name: "Introduction", description: "Overview of the service in the location" },
        { name: "Services Offered", description: "Detailed service breakdown" },
        { name: "Why Choose Us", description: "Brand differentiators" },
        { name: "Service Area", description: "Coverage area details" },
        { name: "FAQ", description: "Frequently asked questions" },
        { name: "Call to Action", description: "Contact and next steps" },
      ],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/blueprints"] });
      setShowCreate(false);
      reset();
      toast({ title: "Blueprint created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/blueprints/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/blueprints"] });
      toast({ title: "Blueprint deleted" });
    },
  });

  const pageTypeColors: Record<string, string> = {
    service_city: "bg-blue-500/10 text-blue-600",
    state_hub: "bg-violet-500/10 text-violet-600",
    city_hub: "bg-emerald-500/10 text-emerald-600",
    industry_city: "bg-orange-500/10 text-orange-600",
    problem_intent: "bg-red-500/10 text-red-600",
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blueprints</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Define page generation templates and content rules.</p>
          </div>
          {selectedAccount && (
            <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />New Blueprint
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setSelectedAccount} value={selectedAccount}>
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
            <Layers className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage its blueprints</p>
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1,2,3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : blueprints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-3">
            <Layers className="size-12 text-muted-foreground/30" />
            <div>
              <h3 className="font-semibold">No blueprints yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Create a blueprint to define how pages will be generated.</p>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>Create Blueprint</Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {blueprints.map((bp: any) => (
              <Card key={bp.id} className="hover:border-primary/40 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm font-semibold">{bp.name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5 capitalize">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${pageTypeColors[bp.pageType] || "bg-muted"}`}>
                          {bp.pageType?.replace(/_/g, " ")}
                        </span>
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2 text-destructive cursor-pointer"
                          onClick={() => confirm("Delete blueprint?") && remove.mutate(bp.id)}>
                          <Trash2 className="size-4" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <div className="font-mono bg-muted rounded p-2 text-muted-foreground truncate">{bp.titleTemplate}</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-muted-foreground">Min words: <span className="font-medium text-foreground">{bp.requiredWordCount}</span></span>
                    <span className="text-muted-foreground">Min score: <span className="font-medium text-foreground">{(parseFloat(bp.minPublishScore) * 100).toFixed(0)}%</span></span>
                    <span className="text-muted-foreground">Sections: <span className="font-medium text-foreground">{(bp.sections as any[])?.length || 0}</span></span>
                  </div>
                  {!bp.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Blueprint</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Blueprint Name</Label>
              <Input placeholder="Service + City Page" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Page Type</Label>
              <Select onValueChange={v => setValue("pageType", v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="service_city">Service + City</SelectItem>
                  <SelectItem value="state_hub">State Hub</SelectItem>
                  <SelectItem value="city_hub">City Hub</SelectItem>
                  <SelectItem value="industry_city">Industry + City</SelectItem>
                  <SelectItem value="problem_intent">Problem Intent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title Template</Label>
              <Input placeholder="{service} in {location}, {state} | {brand}" {...register("titleTemplate", { required: true })} />
              <p className="text-xs text-muted-foreground">Use: &#123;service&#125; &#123;location&#125; &#123;state&#125; &#123;brand&#125; &#123;industry&#125;</p>
            </div>
            <div className="space-y-1.5">
              <Label>H1 Template</Label>
              <Input placeholder="Professional {service} in {location}" {...register("h1Template", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Meta Description Template</Label>
              <Textarea placeholder="Need {service} in {location}? {brand} provides..." rows={2} {...register("metaDescTemplate", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Slug Template</Label>
              <Input placeholder="{service}-{location}" {...register("slugTemplate", { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Min Word Count</Label>
                <Input type="number" defaultValue={700} {...register("requiredWordCount", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>Min Publish Score</Label>
                <Input placeholder="0.65" defaultValue="0.65" {...register("minPublishScore")} />
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
