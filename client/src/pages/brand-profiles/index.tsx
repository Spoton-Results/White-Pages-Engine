import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Briefcase, Building2, Phone, Mail, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

export default function BrandProfilesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset } = useForm<any>();

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["/api/brand-profiles", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/brand-profiles`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  useEffect(() => {
    if ((accounts as any[]).length > 0 && !selectedAccount) {
      setSelectedAccount((accounts as any[])[0].id);
    }
  }, [accounts]);

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/brand-profiles`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brand-profiles"] });
      setShowCreate(false);
      reset();
      toast({ title: "Brand profile created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/brand-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brand-profiles"] });
      toast({ title: "Brand profile deleted" });
    },
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Brand Profiles</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage brand voice, identity, and contact details for content generation.</p>
          </div>
          {selectedAccount && (
            <Button className="gap-2" size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />New Brand Profile
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
            <Briefcase className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage brand profiles</p>
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1,2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : brands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-3">
            <Briefcase className="size-12 text-muted-foreground/30" />
            <div>
              <h3 className="font-semibold">No brand profiles yet</h3>
              <p className="text-muted-foreground text-sm">Create a brand profile to personalize generated content.</p>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>Create Profile</Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {brands.map((brand: any) => (
              <Card key={brand.id} className="hover:border-primary/40 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{brand.name}</CardTitle>
                      {brand.tagline && <p className="text-xs text-muted-foreground italic mt-0.5">"{brand.tagline}"</p>}
                    </div>
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => confirm("Delete profile?") && remove.mutate(brand.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {brand.description && <p className="text-muted-foreground text-xs line-clamp-2">{brand.description}</p>}
                  {brand.phone && <div className="flex items-center gap-2 text-xs"><Phone className="size-3.5 text-muted-foreground" />{brand.phone}</div>}
                  {brand.email && <div className="flex items-center gap-2 text-xs"><Mail className="size-3.5 text-muted-foreground" />{brand.email}</div>}
                  {brand.voiceAndTone && (
                    <div className="bg-muted/50 rounded px-2 py-1.5 text-xs text-muted-foreground">
                      <span className="font-medium">Voice: </span>{brand.voiceAndTone.substring(0, 100)}...
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Brand Profile</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Brand Name</Label>
              <Input placeholder="Acme Plumbing Co" {...register("name", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label>Tagline</Label>
              <Input placeholder="Atlanta's Most Trusted Plumbers" {...register("tagline")} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Brief brand description..." rows={2} {...register("description")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="(404) 555-0100" {...register("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input placeholder="info@brand.com" {...register("email")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Voice & Tone</Label>
              <Textarea placeholder="Professional, trustworthy, local. Use direct language..." rows={2} {...register("voiceAndTone")} />
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
