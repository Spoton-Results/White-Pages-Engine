import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  ChevronRight, ChevronLeft, Copy, CheckCircle2, XCircle,
  Loader2, Briefcase, Network, Layout, Layers,
} from "lucide-react";

interface CloneSummary {
  services: number;
  queryClusters: number;
  blueprints: number;
  variationBankServices: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  sourceAccountId: string;
  sourceAccountName: string;
  agencyId: string;
}

export function CloneDialog({ open, onClose, sourceAccountId, sourceAccountName, agencyId }: Props) {
  const [, navigate] = useLocation();

  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState("");
  const [domain, setDomain] = useState("");

  const [cloneServices, setCloneServices] = useState(true);
  const [cloneQueryClusters, setCloneQueryClusters] = useState(true);
  const [cloneBlueprints, setCloneBlueprints] = useState(true);
  const [cloneVariationBanks, setCloneVariationBanks] = useState(true);

  const [summary, setSummary] = useState<CloneSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const [isCloning, setIsCloning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; accountId?: string; websiteId?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setBusinessName("");
      setDomain("");
      setCloneServices(true);
      setCloneQueryClusters(true);
      setCloneBlueprints(true);
      setCloneVariationBanks(true);
      setSummary(null);
      setSummaryError("");
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && step === 2 && !summary && !loadingSummary) {
      setLoadingSummary(true);
      setSummaryError("");
      api.get<CloneSummary>(`/api/accounts/${sourceAccountId}/clone-summary`)
        .then(data => setSummary(data))
        .catch(e => setSummaryError(e.message || "Failed to load counts"))
        .finally(() => setLoadingSummary(false));
    }
  }, [open, step, sourceAccountId, summary, loadingSummary]);

  const canGoNext = () => {
    if (step === 1) return businessName.trim().length > 0 && domain.trim().length > 0;
    if (step === 2) return cloneServices || cloneQueryClusters || cloneBlueprints || cloneVariationBanks;
    return false;
  };

  const runClone = async () => {
    setIsCloning(true);
    setResult(null);
    try {
      const res = await api.post<any>(`/api/accounts/${sourceAccountId}/clone`, {
        agencyId,
        businessName,
        domain,
        cloneServices,
        cloneQueryClusters,
        cloneBlueprints,
        cloneVariationBanks,
      });
      setResult({ success: true, accountId: res.accountId, websiteId: res.websiteId });
    } catch (e: any) {
      setResult({ success: false, error: e.message || "Clone failed" });
    } finally {
      setIsCloning(false);
    }
  };

  const categories = summary
    ? [
        {
          key: "services",
          label: "Services",
          count: summary.services,
          checked: cloneServices,
          setChecked: setCloneServices,
          icon: Briefcase,
          desc: "Service names, slugs, descriptions, keywords",
        },
        {
          key: "queryClusters",
          label: "Query Clusters",
          count: summary.queryClusters,
          checked: cloneQueryClusters,
          setChecked: setCloneQueryClusters,
          icon: Network,
          desc: "Intent types, keywords, search volumes",
        },
        {
          key: "blueprints",
          label: "Blueprints",
          count: summary.blueprints,
          checked: cloneBlueprints,
          setChecked: setCloneBlueprints,
          icon: Layout,
          desc: "Page templates, title/meta/slug patterns, sections",
        },
        {
          key: "variationBanks",
          label: "Variation Bank Content",
          count: summary.variationBankServices,
          checked: cloneVariationBanks,
          setChecked: setCloneVariationBanks,
          icon: Layers,
          desc: "All written section variations (intro, benefits, FAQ, etc.)",
          countLabel: "services with banks",
        },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[500px] max-sm:w-[calc(100vw-2rem)] max-sm:max-w-none max-sm:max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-4 text-primary" />
            Clone Client Setup
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs mb-1">
          {["Name", "Choose", "Confirm"].map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={n} className="flex items-center gap-1">
                <span
                  className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                    active ? "bg-primary text-primary-foreground" :
                    done ? "bg-emerald-500/10 text-emerald-600" :
                    "text-muted-foreground"
                  }`}
                >
                  {done && <CheckCircle2 className="size-3 inline mr-0.5" />}{label}
                </span>
                {i < 2 && <ChevronRight className="size-3 text-muted-foreground" />}
              </div>
            );
          })}
        </div>

        {/* ── Step 1: Name the new client ── */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Cloning setup from: <span className="font-medium text-foreground">{sourceAccountName}</span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="clone-name">New client business name *</Label>
                <Input
                  id="clone-name"
                  placeholder="Acme Roofing Co"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  data-testid="input-clone-business-name"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clone-domain">New domain (no https) *</Label>
                <Input
                  id="clone-domain"
                  placeholder="acmeroofing.com"
                  value={domain}
                  onChange={e => setDomain(e.target.value.replace(/^https?:\/\//, ""))}
                  data-testid="input-clone-domain"
                />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/30 text-xs text-muted-foreground">
                <Checkbox checked disabled className="opacity-60" />
                <span>This client is under the same agency — <span className="italic">always on</span></span>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Choose what to clone ── */}
        {step === 2 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Select which content infrastructure to copy from <strong>{sourceAccountName}</strong>.
            </p>
            {loadingSummary ? (
              <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />Loading counts...
              </div>
            ) : summaryError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {summaryError}
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map(cat => {
                  const Icon = cat.icon;
                  return (
                    <label
                      key={cat.key}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors"
                      data-testid={`checkbox-clone-${cat.key}`}
                    >
                      <Checkbox
                        checked={cat.checked}
                        onCheckedChange={v => cat.setChecked(!!v)}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-sm">{cat.label}</span>
                          <Badge variant="secondary" className="text-xs ml-auto">
                            {cat.count} {cat.countLabel ?? (cat.count === 1 ? "record" : "records")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{cat.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Pages, jobs, sitemaps, and analytics data are never copied.
            </p>
          </div>
        )}

        {/* ── Step 3: Confirm and clone ── */}
        {step === 3 && !result && !isCloning && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">New client</div>
                <div className="font-semibold">{businessName}</div>
                <div className="text-xs font-mono text-muted-foreground">{domain}</div>
              </div>
              <div className="border-t pt-3">
                <div className="text-xs text-muted-foreground mb-2">Copying from {sourceAccountName}:</div>
                <div className="space-y-1">
                  {[
                    { label: "Services", active: cloneServices, count: summary?.services },
                    { label: "Query Clusters", active: cloneQueryClusters, count: summary?.queryClusters },
                    { label: "Blueprints", active: cloneBlueprints, count: summary?.blueprints },
                    { label: "Variation Banks", active: cloneVariationBanks, count: summary?.variationBankServices, countLabel: "service banks" },
                  ].map(item => (
                    <div key={item.label} className={`flex items-center justify-between text-xs ${item.active ? "" : "opacity-40"}`}>
                      <span className="flex items-center gap-1.5">
                        {item.active
                          ? <CheckCircle2 className="size-3 text-emerald-600" />
                          : <XCircle className="size-3 text-muted-foreground" />}
                        {item.label}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {item.active ? `${item.count ?? "—"} ${item.countLabel ?? "records"}` : "skipped"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Button
              className="w-full gap-2"
              onClick={runClone}
              data-testid="button-confirm-clone"
            >
              <Copy className="size-4" />Create Cloned Client
            </Button>
          </div>
        )}

        {/* Progress */}
        {isCloning && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="text-sm font-medium">Cloning {sourceAccountName}…</div>
            <div className="text-xs text-muted-foreground">Creating account, website, and copying infrastructure</div>
          </div>
        )}

        {/* Result */}
        {result && !isCloning && (
          <div className="py-2 space-y-4">
            {result.success ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-5 flex-shrink-0" />
                  Clone complete.
                </div>
                <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
                  Update the brand profile with the new client's brand details before running generation.
                </p>
                <div className="flex gap-2 flex-wrap pt-1">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      onClose();
                      navigate(`/bank-health?websiteId=${result.websiteId}`);
                    }}
                    data-testid="button-go-to-new-client"
                  >
                    Go to New Client
                  </Button>
                  <Button size="sm" variant="outline" onClick={onClose} data-testid="button-close-clone">
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-destructive">
                  <XCircle className="size-5 flex-shrink-0" />
                  Clone failed.
                </div>
                <p className="text-xs font-mono bg-muted rounded px-2 py-1.5 text-muted-foreground">
                  {result.error}
                </p>
                <Button size="sm" variant="outline" onClick={() => setResult(null)} data-testid="button-retry-clone">
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Navigation footer */}
        {!isCloning && !result && (
          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
              data-testid="button-clone-back"
            >
              <ChevronLeft className="size-4 mr-1" />
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step < 3 && (
              <Button
                size="sm"
                onClick={() => setStep(s => s + 1)}
                disabled={!canGoNext() || loadingSummary}
                data-testid="button-clone-next"
              >
                Next <ChevronRight className="size-4 ml-1" />
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
