import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clipboard, Globe, Loader2, RefreshCcw, Trash2, ExternalLink } from "lucide-react";

type Website = { id: string; name: string; domain: string; accountId?: string; status?: string };
type ClientDomain = {
  id: string;
  hostname: string;
  status: string;
  ssl_status?: string | null;
  cloudflare_hostname_id?: string | null;
  ownership_txt_name?: string | null;
  ownership_txt_value?: string | null;
  error?: string | null;
  updated_at?: string;
  verified_at?: string | null;
};
type DomainResponse = { dnsTarget: string; domains: ClientDomain[] };

const CLIENT_CNAME_TARGET = "origin.spotonresults.com";

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

function statusVariant(status?: string) {
  if (status === "active") return "default" as const;
  if (status === "cloudflare_error") return "destructive" as const;
  return "secondary" as const;
}

function cnameName(hostname: string) {
  const host = normalizeHost(hostname);
  if (!host) return "pages";
  return host.split(".")[0] || "pages";
}

export default function ClientDomainsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [websiteId, setWebsiteId] = useState<string>("");
  const [hostname, setHostname] = useState("");
  const [hostnameTouched, setHostnameTouched] = useState(false);

  const { data: websites = [], isLoading: websitesLoading } = useQuery({
    queryKey: ["/api/websites"],
    queryFn: () => api.get<Website[]>("/api/websites"),
  });

  const selectedWebsite = useMemo(() => (websites as Website[]).find((w) => w.id === websiteId), [websites, websiteId]);
  const selectedWebsiteHost = selectedWebsite?.domain ? normalizeHost(selectedWebsite.domain) : "";
  const effectiveHostname = normalizeHost(hostname || selectedWebsiteHost);

  useEffect(() => {
    if (!selectedWebsiteHost) return;
    if (!hostnameTouched) setHostname(selectedWebsiteHost);
  }, [selectedWebsiteHost, hostnameTouched]);

  const { data, isLoading: domainsLoading } = useQuery({
    queryKey: ["/api/websites", websiteId, "client-domains"],
    enabled: !!websiteId,
    queryFn: () => api.get<DomainResponse>(`/api/websites/${websiteId}/client-domains`),
  });

  const dnsTarget = CLIENT_CNAME_TARGET;

  const addDomain = useMutation({
    mutationFn: (host: string) => api.post(`/api/websites/${websiteId}/client-domains`, { hostname: host }),
    onSuccess: () => {
      setHostnameTouched(false);
      queryClient.invalidateQueries({ queryKey: ["/api/websites", websiteId, "client-domains"] });
      toast({ title: "Client domain added", description: "Cloudflare registration was attempted and the DNS instructions are ready." });
    },
    onError: (err: any) => toast({ title: "Could not add domain", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  const checkDomain = useMutation({
    mutationFn: (id: string) => api.post(`/api/client-domains/${id}/check`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/websites", websiteId, "client-domains"] });
      toast({ title: "Domain checked", description: "Status was refreshed from Cloudflare." });
    },
    onError: (err: any) => toast({ title: "Check failed", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  const deleteDomain = useMutation({
    mutationFn: (id: string) => api.delete(`/api/client-domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/websites", websiteId, "client-domains"] });
      toast({ title: "Client domain deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err?.message || "Please try again.", variant: "destructive" }),
  });

  const copy = async (text: string, label = "Copied") => {
    await navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const host = normalizeHost(effectiveHostname);
    if (!websiteId) return toast({ title: "Select a website first", variant: "destructive" });
    if (!host || !host.includes(".")) return toast({ title: "Enter a valid hostname", description: "Example: pages.clientdomain.com", variant: "destructive" });
    addDomain.mutate(host);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Globe className="size-7" /> Client Domains</h1>
            <p className="text-muted-foreground max-w-3xl">Connect a client subdomain like <strong>pages.clientdomain.com</strong> to a Nexus website. Clients create one CNAME record pointing to your origin hostname.</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>1. Select Nexus Website</CardTitle>
            <CardDescription>This is the website record that the client subdomain should serve.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={websiteId} onValueChange={(value) => { setWebsiteId(value); setHostnameTouched(false); }} disabled={websitesLoading}>
              <SelectTrigger className="max-w-xl"><SelectValue placeholder={websitesLoading ? "Loading websites..." : "Choose a website"} /></SelectTrigger>
              <SelectContent>
                {(websites as Website[]).map((site) => <SelectItem key={site.id} value={site.id}>{site.name} — {site.domain}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedWebsite && <p className="mt-3 text-sm text-muted-foreground">Selected: <strong>{selectedWebsite.name}</strong> ({selectedWebsite.domain})</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Add Client Subdomain</CardTitle>
            <CardDescription>The hostname is auto-filled from the selected Website domain. Only edit it if you are intentionally attaching a different hostname.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="hostname">Client hostname</Label>
                <Input id="hostname" value={hostname} onChange={(e) => { setHostnameTouched(true); setHostname(e.target.value); }} placeholder={selectedWebsiteHost || "pages.clientdomain.com"} disabled={!websiteId || addDomain.isPending} />
                {selectedWebsiteHost && <p className="text-xs text-muted-foreground">Default from selected website: <span className="font-mono">{selectedWebsiteHost}</span></p>}
              </div>
              <Button type="submit" className="md:self-end" disabled={!websiteId || addDomain.isPending}>{addDomain.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}Add Domain</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. DNS Instructions for Client</CardTitle>
            <CardDescription>Give this exact CNAME record to the client or their DNS person.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Type</div><div className="font-mono font-semibold">CNAME</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Name</div><div className="font-mono font-semibold">{cnameName(effectiveHostname)}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Target</div><div className="font-mono font-semibold break-all">{dnsTarget}</div></div>
            </div>
            <Button variant="outline" size="sm" onClick={() => copy(`Type: CNAME\nName: ${cnameName(effectiveHostname)}\nTarget: ${dnsTarget}`, "DNS instructions copied")}><Clipboard className="size-4 mr-2" />Copy DNS Instructions</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connected Domains</CardTitle>
            <CardDescription>Check Cloudflare status, open health tests, and remove domains.</CardDescription>
          </CardHeader>
          <CardContent>
            {!websiteId ? <p className="text-muted-foreground">Select a website to view its domains.</p> : domainsLoading ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading domains...</div> : (data?.domains?.length || 0) === 0 ? <p className="text-muted-foreground">No client domains connected for this website yet.</p> : (
              <div className="space-y-4">
                {data!.domains.map((domain) => (
                  <div key={domain.id} className="rounded-xl border p-4 space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-semibold text-lg flex items-center gap-2">{domain.hostname} {domain.status === "active" ? <CheckCircle2 className="size-4 text-green-600" /> : null}</div>
                        <div className="text-sm text-muted-foreground">Updated {domain.updated_at ? new Date(domain.updated_at).toLocaleString() : "recently"}</div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant={statusVariant(domain.status)}>{domain.status || "pending_dns"}</Badge>
                        {domain.ssl_status ? <Badge variant="outline">SSL: {domain.ssl_status}</Badge> : null}
                      </div>
                    </div>
                    {domain.error ? <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{domain.error}</div> : null}
                    {domain.ownership_txt_name || domain.ownership_txt_value ? <div className="rounded-md bg-muted p-3 text-sm"><div className="font-medium mb-1">Cloudflare ownership validation may require TXT:</div><div className="font-mono break-all">{domain.ownership_txt_name}</div><div className="font-mono break-all">{domain.ownership_txt_value}</div></div> : null}
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => checkDomain.mutate(domain.id)} disabled={checkDomain.isPending}><RefreshCcw className="size-4 mr-2" />Check Status</Button>
                      <Button variant="outline" size="sm" onClick={() => window.open(`https://${domain.hostname}/.well-known/nexus-domain-health`, "_blank")}><ExternalLink className="size-4 mr-2" />Health Test</Button>
                      <Button variant="outline" size="sm" onClick={() => window.open(`https://${domain.hostname}/`, "_blank")}><ExternalLink className="size-4 mr-2" />Open Site</Button>
                      <Button variant="destructive" size="sm" onClick={() => deleteDomain.mutate(domain.id)} disabled={deleteDomain.isPending}><Trash2 className="size-4 mr-2" />Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
