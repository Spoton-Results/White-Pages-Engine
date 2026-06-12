import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Briefcase, Phone, Mail, Trash2, Sparkles, Loader2, CheckCircle2, ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { useAccountContext } from "@/contexts/account-context";
import { AccountPicker } from "@/components/shared/AccountPicker";

export default function BrandProfilesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { selectedAccountId, accountsLoading } = useAccountContext();
  const selectedAccount = selectedAccountId;
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, reset, setValue, watch } = useForm<any>();

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ tagline: string; description: string; voiceAndTone: string } | null>(null);

  const brandName = watch("name");

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["/api/brand-profiles", selectedAccount],
    queryFn: () => selectedAccount ? api.get<any[]>(`/api/accounts/${selectedAccount}/brand-profiles`) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  // CHANGED: fetch saved media for displayed brand profiles
  const { data: brandMediaByProfile = {} } = useQuery({
    queryKey: ["/api/brand-profiles/media", selectedAccount, (brands as any[]).map((b: any) => b.id).join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        (brands as any[]).map(async (brand: any) => {
          const media = await api.get<any[]>(`/api/brand-profiles/${brand.id}/media`);
          return [brand.id, media];
        })
      );
      return Object.fromEntries(entries);
    },
    enabled: !!selectedAccount && (brands as any[]).length > 0,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post(`/api/accounts/${selectedAccount}/brand-profiles`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brand-profiles", selectedAccount] });
      setShowCreate(false);
      reset();
      setAiResult(null);
      toast({ title: "Brand profile created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/brand-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brand-profiles", selectedAccount] });
      toast({ title: "Brand profile deleted" });
    },
  });

  async function handleAiSuggest() {
    if (!selectedAccount) {
      toast({ title: "Select an account first", variant: "destructive" });
      return;
    }
    if (!brandName?.trim()) {
      toast({ title: "Enter brand name first", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiResult(null);
    try {
      const result = await api.post<any>(`/api/accounts/${selectedAccount}/brand-profiles/ai-suggest`, {
        name: brandName,
        websiteUrl: watch("websiteUrl"),
        industryName: watch("industryName"),
      });
      setAiResult(result);
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiResult() {
    if (!aiResult) return;
    setValue("tagline", aiResult.tagline);
    setValue("description", aiResult.description);
    setValue("voiceAndTone", aiResult.voiceAndTone);
    setAiResult(null);
    toast({ title: "Fields filled from AI" });
  }

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

        <AccountPicker countLabel={selectedAccount ? `${(brands as any[]).length} brand profiles` : undefined} />

        {accountsLoading ? (
          <div className="bg-card rounded-lg border p-4">
            <Skeleton className="h-10 w-64" />
          </div>
        ) : !selectedAccount ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Briefcase className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select an account to manage brand profiles</p>
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1,2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        ) : (brands as any[]).length === 0 ? (
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
            {(brands as any[]).map((brand: any) => (
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

                  {/* CHANGED: display saved brand media only */}
                  {Array.isArray((brandMediaByProfile as any)[brand.id]) && (brandMediaByProfile as any)[brand.id].length > 0 && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                        <ImageIcon className="size-3.5" />
                        Brand Media
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(brandMediaByProfile as any)[brand.id].map((media: any) => (
                          <div key={media.id} className="rounded-md border overflow-hidden bg-muted/30">
                            <img
                              src={
                                (media.publicUrl || media.public_url)?.startsWith("http")
                                  ? (media.publicUrl || media.public_url)
                                  : `https://pub-1e7626f01f4a4399915b608da09ccc25.r2.dev/${media.r2Key || media.r2_key}`
                              }
                              alt={media.altText || media.alt_text || "Brand media"}
                              className="h-24 w-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) { reset(); setAiResult(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Brand Profile</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit(d => create.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Brand Name</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs text-violet-600 border-violet-300 hover:bg-violet-50"
                  disabled={aiLoading || !brandName?.trim() || !selectedAccount}
                  onClick={handleAiSuggest}
                  data-testid="button-brand-ai-suggest"
                >
                  {aiLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {aiLoading ? "Generating…" : "AI Generate Fields"}
                </Button>
              </div>
              <Input placeholder="Acme Plumbing Co" {...register("name", { required: true })} data-testid="input-brand-name" />
            </div>

            {aiResult && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-violet-700 text-xs font-semibold">
                  <CheckCircle2 className="size-3.5" />AI Generated Fields
                </div>
                <p className="text-xs text-violet-800 italic">"{aiResult.tagline}"</p>
                <p className="text-xs text-muted-foreground">{aiResult.description}</p>
                <p className="text-xs text-muted-foreground border-t pt-2">{aiResult.voiceAndTone}</p>
                <Button type="button" size="sm" className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={applyAiResult}>
                  <CheckCircle2 className="size-3.5" />Apply These Fields
                </Button>
              </div>
            )}

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
              <Button type="submit" disabled={create.isPending || !selectedAccount}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
