import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function PublishedMaintenancePage() {
  const { toast } = useToast();
  const [websiteId, setWebsiteId] = useState("");
  const { data: websites = [] } = useQuery({ queryKey: ["/api/websites"], queryFn: () => api.get<any[]>("/api/websites") });
  const selectedWebsite = websiteId || (websites as any[])[0]?.id || "";
  const currentWebsite = (websites as any[]).find((w: any) => w.id === selectedWebsite);
  const action = useMutation({
    mutationFn: () => api.delete<any>(`/api/websites/${selectedWebsite}/pages/purge`),
    onSuccess: (result) => toast({ title: "Complete", description: `${result?.deleted?.pages ?? 0} page rows and ${result?.deleted?.sitemaps ?? 0} sitemap rows processed.` }),
    onError: (error: any) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });
  const run = () => {
    const label = currentWebsite?.settings?.parentDomain || currentWebsite?.domain || selectedWebsite;
    if (!window.confirm(`Run page maintenance for ${label}?`)) return;
    if (window.prompt("Type CONFIRM") !== "CONFIRM") return;
    action.mutate();
  };
  return (
    <DashboardLayout>
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Published Pages Maintenance</h1>
        <Select value={selectedWebsite} onValueChange={setWebsiteId}>
          <SelectTrigger><SelectValue placeholder="Select website" /></SelectTrigger>
          <SelectContent>{(websites as any[]).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.settings?.parentDomain || w.domain}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="destructive" onClick={run} disabled={!selectedWebsite || action.isPending}>{action.isPending ? "Working…" : "Run Website Page Maintenance"}</Button>
      </div>
    </DashboardLayout>
  );
}
