import DashboardLayout from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Globe, Briefcase, MapPin, Wrench, Layers, Zap,
  FileText, CheckCircle, Map, Users, ChevronDown, ChevronRight,
  ArrowRight, AlertCircle, Info, Terminal, Link2, BookOpen, Database, Shuffle,
  Sparkles, Loader2, CheckCircle2, XCircle, Circle
} from "lucide-react";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Step {
  num: string;
  icon: any;
  title: string;
  where: string;
  body: React.ReactNode;
}

const PHASES: { label: string; color: string; steps: Step[] }[] = [
  {
    label: "One-Time Setup",
    color: "bg-violet-500",
    steps: [
      {
        num: "1",
        icon: Building2,
        title: "Create an Account",
        where: "Platform → Accounts",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Each client company gets its own Account. Accounts are the top-level container — all websites, pages, and settings live inside one.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Accounts</strong> and click <strong>Create Account</strong>.</li>
              <li>Give it the client's company name and a URL-safe slug.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>SpotOn Results and SubTracker are already set up. For a new client, create a fresh account for them.</span>
            </div>
          </div>
        ),
      },
      {
        num: "2",
        icon: Globe,
        title: "Create a Website",
        where: "Platform → Websites",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>A website maps to a real domain and holds all of its published pages. One account can have multiple websites.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Websites</strong> → <strong>Add Website</strong>.</li>
              <li>Enter the subdomain Nexus will serve pages from (e.g. <code>pages.spotonresults.com</code>).</li>
              <li>Set <strong>Parent Domain</strong> (the brand's main site) and <strong>Proxy Path</strong> (e.g. <code>/pages</code>) — these build correct canonical URLs.</li>
              <li>Select the Account it belongs to.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>The domain here must match exactly what Cloudflare Workers send as the host header — any mismatch causes 404s on all pages.</span>
            </div>
          </div>
        ),
      },
      {
        num: "3",
        icon: Briefcase,
        title: "Create a Brand Profile",
        where: "Platform → Brand Profiles",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>The brand profile controls how every published page looks and reads — the name, phone, CTA text, and main website link all flow from here.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Brand Profiles</strong> → <strong>New Brand Profile</strong>.</li>
              <li>Enter the business name, phone number, main website URL, and tagline.</li>
              <li>Set the <strong>CTA Heading</strong> and <strong>CTA Text</strong> — these appear in the contact section of every page.</li>
              <li>Link the brand profile to your website in <strong>Website Settings</strong>.</li>
            </ul>
          </div>
        ),
      },
      {
        num: "4",
        icon: Layers,
        title: "Create a Blueprint",
        where: "Platform → Blueprints",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>A Blueprint is the master recipe that defines which services and locations get pages, and what page type to generate.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Blueprints</strong> → <strong>New Blueprint</strong>.</li>
              <li>Choose a page type: <em>Service + City</em> or <em>State Hub</em>.</li>
              <li>Link it to the website and select which locations and services to include.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-700">
              <CheckCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>You typically need one blueprint — the system handles all the service × location math automatically.</span>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    label: "Content — Variation Banks (The Engine)",
    color: "bg-blue-500",
    steps: [
      {
        num: "5",
        icon: Database,
        title: "Understand Variation Banks",
        where: "Content → Variation Banks",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Variation Banks are the heart of the system. Instead of calling AI for every page (slow and expensive), you build a bank of pre-written content for each service. When pages are generated, Nexus randomly mixes content from the bank — so every page is unique, even across 500,000+ pages.</p>
            <div className="mt-3 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Shuffle className="size-3" />How Variation Works
              </div>
              <div className="p-3 space-y-1.5 text-xs">
                {[
                  ["Service Bank", "One bank per service (e.g. \"Credit Card Processing\")"],
                  ["Multiple Variations", "Each bank has 5–10 different versions of headlines, body text, CTAs"],
                  ["Random Mix", "Nexus picks different combinations for each page — Denver gets variation 3, Miami gets variation 7"],
                  ["Location Injected", "City name, state name, and state abbreviation are inserted automatically"],
                  ["Result", "500,000 unique pages from a few dozen service banks"],
                ].map(([step, desc], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="size-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                    <div><span className="font-medium text-foreground">{step}</span><span className="text-muted-foreground"> — {desc}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ),
      },
      {
        num: "6",
        icon: Zap,
        title: "Generate Bank Content with AI",
        where: "Content → Variation Banks → [Service] → Generate",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>You don't have to write variation content by hand. Use the built-in AI generator (Claude Haiku) to fill an entire bank in seconds.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Variation Banks</strong> and select a website.</li>
              <li>Click a service to open its bank, or click <strong>Generate All Banks</strong> to fill every service at once.</li>
              <li>Review the generated content — you can edit any individual variation before saving.</li>
              <li>AI generation runs once; the content is stored permanently so page generation doesn't need AI again.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>Check every bank after AI generation. The AI uses the service name as context — if the service name is vague, the content may be generic. Edit it to be more specific to your client's business.</span>
            </div>
          </div>
        ),
      },
      {
        num: "7",
        icon: Wrench,
        title: "Review and Edit Banks",
        where: "Content → Variation Banks → [Service]",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Before running a bulk generation job, review your banks. The quality of the banks directly determines the quality of every published page.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Each bank should have at least <strong>5 variations</strong> per field — fewer variations mean more identical pages.</li>
              <li>Make sure the content mentions the client's brand, value props, and specific services offered.</li>
              <li>Avoid very long service names — keep them under 80 characters. Very long names generate unreadable URL slugs.</li>
              <li>The <strong>Related Services</strong> section links to sibling services within the same city — make sure all your services have banks so those links work.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>Think of banks like a paragraph library. The more varied and specific your library, the better every page that draws from it.</span>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    label: "Generating Pages at Scale",
    color: "bg-emerald-500",
    steps: [
      {
        num: "8",
        icon: FileText,
        title: "Run a Bulk Generation Job",
        where: "Jobs → New Job",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Once your banks are ready, a single job generates pages for every service × city × state combination — potentially hundreds of thousands of pages.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Jobs</strong> → <strong>New Job</strong>.</li>
              <li>Select your website and blueprint.</li>
              <li>Choose <strong>Generate</strong> (new pages only) or <strong>Overwrite</strong> (rewrite all existing pages with fresh content).</li>
              <li>Click <strong>Start</strong> — generation runs in the background. You can close the browser.</li>
            </ul>
            <div className="mt-3 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Terminal className="size-3" />What Happens Per Page
              </div>
              <div className="p-3 space-y-1.5 text-xs">
                {[
                  ["Service + Location picked", "e.g. \"Credit Card Processing\" + \"Miami, FL\""],
                  ["Variations selected randomly", "Nexus picks one variation of each bank field"],
                  ["Location variables injected", "City, state, abbreviation replaced throughout"],
                  ["Page saved and published", "Instantly live at /pages/{slug}"],
                ].map(([step, desc], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="size-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                    <div><span className="font-medium text-foreground">{step}</span><span className="text-muted-foreground"> — {desc}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>Only run <strong>Overwrite</strong> when you've made meaningful changes to your banks. Overwriting 500K pages takes hours and uses significant server resources. For most maintenance, the render-time fixes work without any overwrite.</span>
            </div>
          </div>
        ),
      },
      {
        num: "9",
        icon: CheckCircle,
        title: "Monitor the Job",
        where: "Jobs",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Watch the Jobs page to track progress. Each job shows a live count of pages created and any errors.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>A healthy job completes thousands of pages per minute.</li>
              <li>If a job stalls or errors, check if the variation banks have content — empty banks cause generation failures.</li>
              <li>You can cancel a running job at any time — pages already created remain published.</li>
            </ul>
          </div>
        ),
      },
      {
        num: "10",
        icon: Map,
        title: "Generate Sitemaps",
        where: "Content → Sitemap Manager",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>XML sitemaps tell Google about all your pages so they get crawled and indexed. Run this after every major generation job.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Select a website and click <strong>Generate Sitemaps</strong>.</li>
              <li>The system creates paginated files (50,000 URLs each) and a sitemap index.</li>
              <li>Submit the sitemap index URL to Google Search Console.</li>
            </ul>
            <div className="mt-3 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Link2 className="size-3" />Sitemap URLs
              </div>
              <div className="p-3 font-mono text-xs space-y-1 bg-zinc-950 text-zinc-200">
                <div><span className="text-zinc-400">SpotOn:</span> spotonresults.com/pages/sitemap.xml</div>
                <div><span className="text-zinc-400">SubTracker:</span> subtrackers.spotonresults.com/pages/sitemap.xml</div>
              </div>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    label: "Traffic & DNS",
    color: "bg-amber-500",
    steps: [
      {
        num: "11",
        icon: Globe,
        title: "How Traffic Gets to Pages",
        where: "Cloudflare Workers (client side)",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Nexus pages are served at the client's own domain (e.g. <code>spotonresults.com/pages/…</code>), not the Nexus platform domain. A Cloudflare Worker on the client's domain intercepts requests and proxies them to Nexus.</p>
            <div className="mt-2 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Terminal className="size-3" />Request Flow
              </div>
              <div className="p-3 space-y-1.5 text-xs">
                {[
                  ["User visits", "spotonresults.com/pages/credit-card-processing-in-miami-florida"],
                  ["Cloudflare Worker", "Intercepts the request, forwards it to sospages.replit.app"],
                  ["Nexus looks up slug", "Finds the page in the database, renders the HTML"],
                  ["Worker returns HTML", "User sees a fully branded SpotOn page"],
                ].map(([step, desc], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="size-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                    <div><span className="font-medium text-foreground">{step}</span><span className="text-muted-foreground"> — {desc}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>If a URL isn't in the database, Nexus automatically generates a page on the spot using the best-matching variation bank — so no URL ever returns a 404 for a valid US service + location combination.</span>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    label: "Platform Administration",
    color: "bg-rose-500",
    steps: [
      {
        num: "12",
        icon: Users,
        title: "Manage Users",
        where: "Platform → Users",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Control who can access the platform and what they can do.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { role: "Super Admin", desc: "Full access to all accounts and platform settings." },
                { role: "Account Admin", desc: "Full access within their own account — websites, jobs, banks." },
                { role: "Editor", desc: "Can run jobs and edit banks within their account." },
                { role: "Viewer", desc: "Read-only — can see pages and stats but cannot make changes." },
              ].map(({ role, desc }) => (
                <div key={role} className="border rounded-md p-2.5 space-y-0.5">
                  <div className="text-xs font-semibold text-foreground">{role}</div>
                  <div className="text-xs">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        ),
      },
      {
        num: "13",
        icon: Zap,
        title: "Recommended Operating Rhythm",
        where: "Ongoing",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Once set up, the day-to-day is light. Most of the work is one-time.</p>
            <div className="space-y-2 mt-2">
              {[
                { freq: "One-time", action: "Set up account, website, brand profile, blueprint, and variation banks. Run the first bulk generation job." },
                { freq: "After adding services", action: "Create a new variation bank, generate AI content for it, then run a targeted generation job for that service only." },
                { freq: "After major bank edits", action: "Run an Overwrite job to push fresh content to all existing pages. Only do this when changes are meaningful." },
                { freq: "After each job", action: "Regenerate sitemaps so Google picks up new pages." },
                { freq: "Monthly", action: "Check Google Search Console for indexing status and crawl errors. Review published page counts." },
              ].map(({ freq, action }, i) => (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-md bg-muted/50 border">
                  <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">{freq}</Badge>
                  <span className="text-xs">{action}</span>
                </div>
              ))}
            </div>
          </div>
        ),
      },
    ],
  },
];

const GLOSSARY = [
  { term: "Account", def: "The top-level container for one client company. Everything — websites, pages, banks — lives inside an account." },
  { term: "Website", def: "A domain within an account. One account can have multiple websites (e.g. a main site and a microsite)." },
  { term: "Brand Profile", def: "The brand's name, phone number, website URL, and CTA copy — stamped on every generated page." },
  { term: "Blueprint", def: "The master recipe that defines which services and locations to generate pages for, and what page type to use." },
  { term: "Variation Bank", def: "A library of pre-written content options for one service. Nexus randomly mixes these to make every page unique." },
  { term: "Variation", def: "One version of a content field (headline, body paragraph, CTA, etc.) inside a bank." },
  { term: "Bulk Generation Job", def: "A background task that creates one page for every service × city × state combination defined in a blueprint." },
  { term: "Overwrite Job", def: "Same as a generation job but rewrites pages that already exist with fresh content from the current banks." },
  { term: "Dynamic Fallback", def: "If a page URL isn't in the database, Nexus builds it live on the spot using the closest matching bank — ensuring no 404s for valid US location URLs." },
  { term: "Slug", def: "The URL-friendly version of a page name. Example: credit-card-processing-in-miami-florida" },
  { term: "Service × Location", def: "The combination that makes each page unique — one service offered in one city in one state." },
  { term: "State Hub", def: "A page for a service in an entire state (e.g. 'Payment Processing in Florida')." },
  { term: "City Page", def: "A page for a service in a specific city (e.g. 'Payment Processing in Miami, Florida')." },
  { term: "Related Services", def: "The section on each page linking to sibling services in the same city — drives internal linking for SEO." },
  { term: "Proxy Path", def: "The URL prefix that Cloudflare adds (e.g. /pages/) so Nexus pages appear on the brand's own domain." },
  { term: "Sitemap", def: "An XML file listing all published page URLs — submitted to Google Search Console so Google knows what to index." },
  { term: "Canonical URL", def: "The authoritative URL for a page. Nexus uses the client's domain (not the platform domain) as canonical." },
  { term: "Schema.org", def: "Structured data embedded in every page so Google can display rich results (business info, breadcrumbs, service details)." },
  { term: "Content Version", def: "The saved HTML content for a page. Each overwrite job creates a new version, replacing the previous one." },
  { term: "Super Admin", def: "A platform-level admin who can see and manage all accounts and websites across the entire platform." },
  { term: "Cloudflare Worker", def: "A small script on the client's Cloudflare account that intercepts traffic and routes /pages/ requests to Nexus." },
];

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const Icon = step.icon;
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <button
        type="button"
        data-testid={`step-card-${step.num}`}
        className="w-full text-left flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">Step {step.num}</span>
            <span className="font-medium text-sm">{step.title}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <ArrowRight className="size-3" />{step.where}
          </div>
        </div>
        {open ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t bg-muted/20">
          {step.body}
        </div>
      )}
    </div>
  );
}

function GlossaryItem({ term, def }: { term: string; def: string }) {
  return (
    <div className="py-3 border-b last:border-0 grid grid-cols-[180px_1fr] gap-4 items-start">
      <dt className="text-sm font-semibold text-foreground">{term}</dt>
      <dd className="text-sm text-muted-foreground">{def}</dd>
    </div>
  );
}

export default function GuidePage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"guide" | "glossary" | "checklist">("guide");
  const [checklistAccount, setChecklistAccount] = useState<string>("");
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklist, setChecklist] = useState<{ healthScore: number; summary: string; steps: Array<{ title: string; description: string; priority: string; done: boolean }> } | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => api.get<any[]>("/api/accounts"),
  });
  const selectedChecklistAccount = checklistAccount || (accounts as any[])[0]?.id || "";

  const handleChecklist = async () => {
    if (!selectedChecklistAccount) return;
    setChecklistLoading(true);
    setChecklist(null);
    try {
      const result = await api.post<any>(`/api/accounts/${selectedChecklistAccount}/ai-checklist`, {});
      setChecklist(result);
    } catch (e: any) {
      toast({ title: "AI error", description: e.message, variant: "destructive" });
    } finally {
      setChecklistLoading(false);
    }
  };

  const priorityColors: Record<string, string> = {
    critical: "text-red-600 border-red-300 bg-red-50",
    important: "text-amber-600 border-amber-300 bg-amber-50",
    "nice-to-have": "text-green-600 border-green-300 bg-green-50",
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations Guide</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            How to set up, generate, and maintain white-pages content at scale.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border rounded-lg p-1 bg-muted/30 w-fit">
          <button
            data-testid="tab-guide"
            onClick={() => setTab("guide")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === "guide" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <BookOpen className="size-3.5" />Step-by-Step Guide
          </button>
          <button
            data-testid="tab-glossary"
            onClick={() => setTab("glossary")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === "glossary" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <FileText className="size-3.5" />Glossary
          </button>
          <button
            data-testid="tab-checklist"
            onClick={() => setTab("checklist")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === "checklist" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Sparkles className="size-3.5" />AI Checklist
          </button>
        </div>

        {tab === "guide" && (
          <>
            {/* Quick-reference flow */}
            <div className="bg-card border rounded-lg p-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Full Workflow at a Glance</div>
              <div className="flex flex-wrap gap-2 items-center text-xs">
                {[
                  "Account", "Website", "Brand Profile", "Blueprint",
                  "Variation Banks", "AI Content", "Bulk Generation", "Sitemap", "Google",
                ].map((label, i, arr) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className="bg-primary/10 text-primary px-2 py-1 rounded font-medium">{label}</span>
                    {i < arr.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
                  </span>
                ))}
              </div>
            </div>

            {PHASES.map((phase) => (
              <div key={phase.label}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`size-2 rounded-full ${phase.color}`} />
                  <span className="text-sm font-semibold">{phase.label}</span>
                </div>
                <div className="space-y-2">
                  {phase.steps.map((step) => (
                    <StepCard key={step.num} step={step} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "glossary" && (
          <div className="bg-card border rounded-lg p-4">
            <dl>
              {GLOSSARY.map(({ term, def }) => (
                <GlossaryItem key={term} term={term} def={def} />
              ))}
            </dl>
          </div>
        )}

        {tab === "checklist" && (
          <div className="space-y-4">
            <div className="bg-card border rounded-lg p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Select an account to generate a personalized AI setup checklist based on what's configured vs. what's still missing.</p>
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={selectedChecklistAccount} onValueChange={setChecklistAccount}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts as any[]).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={checklistLoading || !selectedChecklistAccount}
                  onClick={handleChecklist}
                  data-testid="button-generate-checklist"
                >
                  {checklistLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {checklistLoading ? "Analyzing account…" : "Generate AI Checklist"}
                </Button>
              </div>
            </div>

            {checklist && (
              <div className="space-y-4">
                <div className="bg-card border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Account Health Score</span>
                    <span className={`text-lg font-bold ${checklist.healthScore >= 80 ? "text-green-600" : checklist.healthScore >= 50 ? "text-amber-600" : "text-red-600"}`}>
                      {checklist.healthScore}/100
                    </span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all ${checklist.healthScore >= 80 ? "bg-green-500" : checklist.healthScore >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${checklist.healthScore}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">{checklist.summary}</p>
                </div>

                <div className="space-y-2">
                  {checklist.steps.map((step, i) => (
                    <div key={i} className={`border rounded-lg p-3.5 flex items-start gap-3 ${step.done ? "opacity-60" : ""}`}>
                      <div className="mt-0.5 shrink-0">
                        {step.done
                          ? <CheckCircle2 className="size-4 text-green-500" />
                          : step.priority === "critical"
                            ? <XCircle className="size-4 text-red-500" />
                            : <Circle className="size-4 text-muted-foreground" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : ""}`}>{step.title}</span>
                          <span className={`text-xs border rounded px-1.5 py-0.5 ${priorityColors[step.priority] ?? "text-muted-foreground border-border"}`}>
                            {step.priority}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-center text-xs text-muted-foreground py-4 border-t">
          Nexus White-Pages Platform · Built for SpotOn Results & SubTracker · SaaS-ready
        </div>
      </div>
    </DashboardLayout>
  );
}
