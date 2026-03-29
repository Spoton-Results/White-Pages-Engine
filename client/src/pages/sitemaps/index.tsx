import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Map, RefreshCw, Zap, ExternalLink, FileCode } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export default function SitemapsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedWebsite, setSelectedWebsite] = useState<string>("");

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const { data: sitemaps = [], isLoading } = useQuery({
    queryKey: ["/api/sitemaps", selectedWebsite],
    queryFn: () => selectedWebsite ? api.get<any[]>(`/api/websites/${selectedWebsite}/sitemaps`) : Promise.resolve([]),
    enabled: !!selectedWebsite,
  });

  const generate = useMutation({
    mutationFn: () => api.post(`/api/websites/${selectedWebsite}/sitemaps/generate`, {}),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/sitemaps"] });
      toast({ title: `Sitemaps generated`, description: `${data.keys?.length || 0} sitemap files created.` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const currentWebsite = websites.find((w: any) => w.id === selectedWebsite);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sitemap Manager</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Generate and manage XML sitemaps for published content.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-card p-3 rounded-lg border">
          <Select onValueChange={setSelectedWebsite} value={selectedWebsite}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select website" />
            </SelectTrigger>
            <SelectContent>
              {websites.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWebsite && (
            <Button size="sm" className="gap-2" onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Generate Sitemaps
            </Button>
          )}
          {currentWebsite && (
            <a
              href={`/api/websites/${selectedWebsite}/sitemap.xml`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />View Sitemap Index
            </a>
          )}
        </div>

        {!selectedWebsite ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Map className="size-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Select a website to manage sitemaps</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1,2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : sitemaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border rounded-lg bg-card text-center gap-3">
            <FileCode className="size-12 text-muted-foreground/30" />
            <div>
              <h3 className="font-semibold">No sitemaps generated yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Click "Generate Sitemaps" to create XML sitemaps from all published pages.</p>
            </div>
            <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
              Generate Now
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sitemaps.map((sm: any) => (
              <Card key={sm.id} className="hover:border-primary/30 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <FileCode className="size-4 text-primary" />
                    {sm.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-bold">{sm.urlCount?.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">URLs included</div>
                  <div className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1 truncate">
                    /{sm.slug}.xml
                  </div>
                  {sm.lastGenerated && (
                    <div className="text-xs text-muted-foreground">
                      Last generated {formatDistanceToNow(new Date(sm.lastGenerated))} ago
                    </div>
                  )}
                  {sm.r2Key && (
                    <Badge variant="outline" className="text-xs">Stored in R2</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
