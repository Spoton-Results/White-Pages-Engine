import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Website { id: string; name: string; domain: string; }

interface AutomationSettings {
  autoScoreAfterGeneration: boolean;
  autoAssignTiersAfterScoring: boolean;
  tier1Threshold: number;
  tier2Threshold: number;
  applyTier3: boolean;
  sitemapRegenDebounceMinutes: number;
  googleIndexingEnabled: boolean;
  fallbackHitThreshold: number;
  fallbackHitWindowDays: number;
  autodemoteZeroImpressionDays: number;
  thinBankThreshold: number;
  weeklyEmailEnabled: boolean;
  weeklyEmailRecipients: string[];
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: any;
  readAt: string | null;
  createdAt: string;
}

interface PromotionQueueItem {
  id: string;
  slug: string;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  promoted: boolean;
}

interface DemotionLog {
  id: string;
  pageId: string;
  fromTier: number;
  toTier: number;
  reason: string;
  createdAt: string;
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AutomationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [websiteId, setWebsiteId] = useState("");
  const [form, setForm] = useState<AutomationSettings | null>(null);
  const [emailInput, setEmailInput] = useState("");

  const { data: websites = [] } = useQuery<Website[]>({
    queryKey: ["/api/websites"],
    queryFn: () => fetch("/api/websites", { credentials: "include" }).then(r => r.json()),
  });

  useEffect(() => {
    if (websites.length > 0 && !websiteId) setWebsiteId(websites[0].id);
  }, [websites]);

  const { data: settingsData } = useQuery({
    queryKey: ["/api/websites", websiteId, "automation-settings"],
    queryFn: () => fetch(`/api/websites/${websiteId}/automation-settings`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  useEffect(() => {
    if (settingsData?.settings) {
      setForm(settingsData.settings);
      setEmailInput((settingsData.settings.weeklyEmailRecipients || []).join(", "));
    }
  }, [settingsData]);

  const { data: notifData, refetch: refetchNotifs } = useQuery({
    queryKey: ["/api/websites", websiteId, "notifications"],
    queryFn: () => fetch(`/api/websites/${websiteId}/notifications?limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  const { data: queueData, refetch: refetchQueue } = useQuery({
    queryKey: ["/api/websites", websiteId, "promotion-queue"],
    queryFn: () => fetch(`/api/websites/${websiteId}/promotion-queue`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  const { data: demotionData } = useQuery({
    queryKey: ["/api/websites", websiteId, "demotion-logs"],
    queryFn: () => fetch(`/api/websites/${websiteId}/demotion-logs?limit=20`, { credentials: "include" }).then(r => r.json()),
    enabled: !!websiteId,
  });

  const saveMutation = useMutation({
    mutationFn: (settings: Partial<AutomationSettings>) =>
      apiRequest("PUT", `/api/websites/${websiteId}/automation-settings`, settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/websites", websiteId, "automation-settings"] });
      toast({ title: "Automation settings saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/notifications/${id}/read`, {}),
    onSuccess: () => refetchNotifs(),
  });

  const dismissQueueMutation = useMutation({
    mutationFn: (logId: string) => apiRequest("POST", `/api/websites/${websiteId}/promotion-queue/${logId}/dismiss`, {}),
    onSuccess: () => { refetchQueue(); toast({ title: "Dismissed from queue" }); },
  });

  const handleSave = () => {
    if (!form) return;
    const recipients = emailInput.split(",").map(e => e.trim()).filter(Boolean);
    saveMutation.mutate({ ...form, weeklyEmailRecipients: recipients });
  };

  const setField = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) =>
    setForm(f => f ? { ...f, [k]: v } : f);

  const notifications: Notification[] = notifData?.notifications || [];
  const queue: PromotionQueueItem[] = queueData?.queue || [];
  const demotions: DemotionLog[] = demotionData?.logs || [];
  const unreadCount: number = notifData?.unreadCount || 0;

  const notifTypeColor: Record<string, string> = {
    fallback_promotion: "bg-yellow-100 border-yellow-400 text-yellow-800",
    thin_bank: "bg-orange-100 border-orange-400 text-orange-800",
    auto_demote: "bg-blue-100 border-blue-400 text-blue-800",
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Automation</h1>
            <p className="text-gray-500 text-sm mt-1">Configure automatic scoring, tier assignment, sitemap regen, and more</p>
          </div>
          <select
            data-testid="select-website"
            className="border rounded px-3 py-2 text-sm"
            value={websiteId}
            onChange={e => setWebsiteId(e.target.value)}
          >
            {websites.map((w: Website) => (
              <option key={w.id} value={w.id}>{w.name || w.domain}</option>
            ))}
          </select>
        </div>

        {!form ? (
          <p className="text-gray-400">Loading settings…</p>
        ) : (
          <>
            {/* ── Settings card ── */}
            <div className="bg-white border rounded-lg shadow-sm p-6 space-y-6">
              <h2 className="font-semibold text-lg">Automation Thresholds</h2>

              {/* Auto 1 + 2 */}
              <Section title="Auto 1 — Score after generation" description="Automatically score all newly generated pages when a bulk job finishes.">
                <Toggle label="Enable" checked={form.autoScoreAfterGeneration} onChange={v => setField("autoScoreAfterGeneration", v)} testId="toggle-auto1" />
              </Section>

              <Section title="Auto 2 — Assign tiers after scoring" description="After scoring, apply tier rules automatically based on quality scores.">
                <Toggle label="Enable" checked={form.autoAssignTiersAfterScoring} onChange={v => setField("autoAssignTiersAfterScoring", v)} testId="toggle-auto2" />
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <NumField label="Tier 1 threshold (≥)" value={form.tier1Threshold} min={0} max={100} onChange={v => setField("tier1Threshold", v)} testId="input-tier1" />
                  <NumField label="Tier 3 threshold (<)" value={form.tier2Threshold} min={0} max={100} onChange={v => setField("tier2Threshold", v)} testId="input-tier2" />
                  <div className="flex items-end">
                    <Toggle label="Demote to Tier 3" checked={form.applyTier3} onChange={v => setField("applyTier3", v)} testId="toggle-tier3" />
                  </div>
                </div>
              </Section>

              {/* Auto 3 */}
              <Section title="Auto 3 — Regenerate sitemap after tier changes" description="Batch tier changes together and rebuild the sitemap once after the debounce window.">
                <NumField label="Debounce (minutes)" value={form.sitemapRegenDebounceMinutes} min={1} max={60} onChange={v => setField("sitemapRegenDebounceMinutes", v)} testId="input-debounce" />
              </Section>

              {/* Auto 4 */}
              <Section title="Auto 4 — Submit Tier 1 URLs to Google Indexing API" description="Fire-and-forget: submit newly promoted Tier 1 page URLs to the Google Indexing API. Never blocks tier changes.">
                <Toggle label="Enable" checked={form.googleIndexingEnabled} onChange={v => setField("googleIndexingEnabled", v)} testId="toggle-auto4" />
              </Section>

              {/* Auto 5 */}
              <Section title="Auto 5 — Fallback URL promotion queue" description="When a fallback URL is hit more than the threshold within the window, flag it for admin review. Admin must approve before any page is generated.">
                <div className="grid grid-cols-2 gap-4">
                  <NumField label="Hit threshold" value={form.fallbackHitThreshold} min={1} max={1000} onChange={v => setField("fallbackHitThreshold", v)} testId="input-fallback-threshold" />
                  <NumField label="Window (days)" value={form.fallbackHitWindowDays} min={1} max={365} onChange={v => setField("fallbackHitWindowDays", v)} testId="input-fallback-window" />
                </div>
              </Section>

              {/* Auto 6 */}
              <Section title="Auto 6 — Auto-demote weak Tier 1 pages (weekly)" description="Pages that have been Tier 1 for the configured number of days with zero impressions are demoted to Tier 2.">
                <NumField label="Zero-impression days before demotion" value={form.autodemoteZeroImpressionDays} min={7} max={365} onChange={v => setField("autodemoteZeroImpressionDays", v)} testId="input-demote-days" />
              </Section>

              {/* Auto 7 */}
              <Section title="Auto 7 — Flag thin banks" description="After every bank update, recalculate completeness. Flag services below the threshold and send an in-app notification.">
                <NumField label="Completeness threshold (%)" value={form.thinBankThreshold} min={0} max={100} onChange={v => setField("thinBankThreshold", v)} testId="input-thin-threshold" />
              </Section>

              {/* Auto 8 */}
              <Section title="Auto 8 — Weekly summary email (Monday 8 AM UTC)" description="Sends a weekly digest per tenant: pages generated, Tier 1 promotions, demotions, top fallback hits, thin banks, average quality score.">
                <Toggle label="Enable" checked={form.weeklyEmailEnabled} onChange={v => setField("weeklyEmailEnabled", v)} testId="toggle-auto8" />
                <div className="mt-2">
                  <label className="text-sm text-gray-600 block mb-1">Recipient emails (comma-separated)</label>
                  <input
                    data-testid="input-email-recipients"
                    type="text"
                    className="border rounded px-3 py-2 text-sm w-full"
                    placeholder="admin@example.com, seo@example.com"
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">Set SMTP_URL environment variable to enable delivery.</p>
                </div>
              </Section>

              <div className="pt-2 border-t">
                <button
                  data-testid="button-save-settings"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-60"
                >
                  {saveMutation.isPending ? "Saving…" : "Save Settings"}
                </button>
              </div>
            </div>

            {/* ── Notifications panel ── */}
            <div className="bg-white border rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-2 text-xs bg-red-500 text-white rounded-full px-2 py-0.5" data-testid="badge-unread">{unreadCount}</span>
                  )}
                </h2>
              </div>
              {notifications.length === 0 ? (
                <p className="text-gray-400 text-sm" data-testid="text-no-notifications">No notifications yet.</p>
              ) : (
                <div className="space-y-3">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      data-testid={`card-notification-${n.id}`}
                      className={`border-l-4 rounded p-3 text-sm ${notifTypeColor[n.type] || "bg-gray-100 border-gray-400"} ${n.readAt ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{n.title}</p>
                          <p className="mt-0.5">{n.message}</p>
                          <p className="text-xs opacity-70 mt-1">{new Date(n.createdAt).toLocaleDateString()}</p>
                        </div>
                        {!n.readAt && (
                          <button
                            data-testid={`button-mark-read-${n.id}`}
                            onClick={() => markReadMutation.mutate(n.id)}
                            className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
                          >Mark read</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Promotion Queue ── */}
            <div className="bg-white border rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-lg mb-1">Promotion Queue</h2>
              <p className="text-sm text-gray-500 mb-4">Fallback URLs that have crossed the hit threshold. Review and approve before generating pages.</p>
              {queue.length === 0 ? (
                <p className="text-gray-400 text-sm" data-testid="text-queue-empty">No URLs pending promotion.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 pr-4">Slug</th>
                        <th className="py-2 pr-4">Hits</th>
                        <th className="py-2 pr-4">First seen</th>
                        <th className="py-2 pr-4">Last seen</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map((item: PromotionQueueItem) => (
                        <tr key={item.id} data-testid={`row-queue-${item.id}`} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-mono text-xs">{item.slug}</td>
                          <td className="py-2 pr-4 font-semibold text-orange-600">{item.hitCount}</td>
                          <td className="py-2 pr-4 text-gray-500">{new Date(item.firstSeenAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-4 text-gray-500">{new Date(item.lastSeenAt).toLocaleDateString()}</td>
                          <td className="py-2">
                            <button
                              data-testid={`button-dismiss-${item.id}`}
                              onClick={() => dismissQueueMutation.mutate(item.id)}
                              className="text-xs text-gray-500 hover:text-red-600 underline"
                            >Dismiss</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Demotion Logs ── */}
            <div className="bg-white border rounded-lg shadow-sm p-6">
              <h2 className="font-semibold text-lg mb-4">Auto-Demotion Log</h2>
              {demotions.length === 0 ? (
                <p className="text-gray-400 text-sm" data-testid="text-no-demotions">No auto-demotions logged yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">Page ID</th>
                        <th className="py-2 pr-4">From → To</th>
                        <th className="py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demotions.map((d: DemotionLog) => (
                        <tr key={d.id} data-testid={`row-demotion-${d.id}`} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-4 text-gray-500">{new Date(d.createdAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-4 font-mono text-xs text-gray-600">{d.pageId.slice(0, 8)}…</td>
                          <td className="py-2 pr-4">
                            <span className="text-blue-600">T{d.fromTier}</span>
                            {" → "}
                            <span className="text-gray-600">T{d.toTier}</span>
                          </td>
                          <td className="py-2 text-gray-600">{d.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-5 last:border-0 last:pb-0">
      <h3 className="font-medium text-gray-800 mb-0.5">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer" data-testid={testId}>
      <div
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-300"}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </div>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

function NumField({ label, value, min, max, onChange, testId }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; testId: string }) {
  return (
    <div>
      <label className="text-xs text-gray-600 block mb-1">{label}</label>
      <input
        data-testid={testId}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="border rounded px-3 py-1.5 text-sm w-full"
      />
    </div>
  );
}
