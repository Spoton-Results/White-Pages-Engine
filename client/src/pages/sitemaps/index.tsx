import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Map, RefreshCw, Zap, ExternalLink, FileCode, Copy, Check, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

const OFFSET_KEY = (websiteId: string) => `gsc_submit_offset_${websiteId}`;

export default function SitemapsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [overrideWebsite, setOverrideWebsite] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [submitOffset, setSubmitOffset] = useState(0);
  const [submitTotal, setSubmitTotal] = useState<number | null>(null);
  const [allDone, setAllDone] = useState(false);

  function copySitemapUrl(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const { data: websites = [] } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<any[]>("/api/websites"),
  });

  const selectedWebsite = overrideWebsite || (websites as any[])[0]?.id || "";

  // Restore saved offset for this website
  useEffect(() => {
    if (!selectedWebsite) return;
    const saved = localStorage.getItem(OFFSET_KEY(selectedWebsite));
    setSubmitOffset(saved ? Number(saved) : 0);
    setSubmitTotal(null);
    setAllDone(false);
  }, [selectedWebsite]);

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

  const submitBatch = useMutation({
    mutationFn: (offset: number) =>
      api.post<{ submitted: number; nextOffset: number; total: number; done: boolean }>(
        `/api/websites/${selectedWebsite}/submit-to-google`,
        { offset },
      ),
    onSuccess: (data) => {
      setSubmitTotal(data.total);
      if (data.done) {
        setAllDone(true);
        localStorage.removeItem(OFFSET_KEY(selectedWebsite));
        setSubmitOffset(data.total);
        toast({ title: "All pages submitted!", description: `${data.total.toLocaleString()} URLs sent to Google Indexing API.` });
      } else {
        const next = data.nextOffset;
        setSubmitOffset(next);
        localStorage.setItem(OFFSET_KEY(selectedWebsite), String(next));
        toast({
          title: `Batch submitted`,
          description: `${data.submitted} URLs sent. ${(data.total - next).toLocaleString()} remaining — come back tomorrow for the next batch.`,
        });
      }
    },
    onError: (err: any) => toast({ title: "Submit error", description: err.message, variant: "destructive" }),
  });

  const currentWebsite = websites.find((w: any) => w.id === selectedWebsite);
  const progressPct = submitTotal ? Math.min(100, Math.round((submitOffset / submitTotal) * 100)) : 0;

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
          <Select onValueChange={setOverrideWebsite} value={selectedWebsite}>
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
            <Button size="sm" className="gap-2" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-generate-sitemaps">
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

        {currentWebsite && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-blue-700 mb-1">Google Search Console — Submit this URL</p>
              <p className="font-mono text-sm text-blue-900 truncate" data-testid="text-sitemap-url">
                https://{currentWebsite.domain}/sitemap.xml
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100"
              onClick={() => copySitemapUrl(`https://${currentWebsite.domain}/sitemap.xml`)}
              data-testid="button-copy-sitemap-url"
            >
              {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        )}

        {/* Google Indexing API — batch submit existing pages */}
        {selectedWebsite && (
          <div className="border rounded-lg bg-card p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <Send className="size-4 text-green-600" />
                  Submit Existing Pages to Google
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Sends 200 URLs per day directly to Google's Indexing API (state hubs first). 
                  Pages are indexed within hours instead of weeks.
                  Come back each day to submit the next batch.
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => submitBatch.mutate(submitOffset)}
                disabled={submitBatch.isPending || allDone}
                data-testid="button-submit-to-google"
              >
                {submitBatch.isPending
                  ? <><RefreshCw className="size-4 animate-spin" />Submitting…</>
                  : allDone
                  ? <><Check className="size-4" />All Done</>
                  : <><Send className="size-4" />{submitOffset === 0 ? "Submit First 200" : "Submit Next 200"}</>
                }
              </Button>
            </div>

            {(submitTotal !== null || submitOffset > 0) && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span data-testid="text-submit-progress">
                    {submitOffset.toLocaleString()} of {(submitTotal ?? "?").toLocaleString()} pages submitted
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2" />
                {!allDone && submitOffset > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ~{Math.ceil(((submitTotal ?? 0) - submitOffset) / 200).toLocaleString()} days remaining at 200/day quota.
                    {" "}Request a quota increase in Google Cloud Console to speed this up.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

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
