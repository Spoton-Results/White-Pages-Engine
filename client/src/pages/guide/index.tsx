import DashboardLayout from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import {
  Building2, Globe, Briefcase, MapPin, Wrench, Layers, Zap,
  FileText, CheckCircle, Map, Users, ChevronDown, ChevronRight,
  ArrowRight, AlertCircle, Info, Terminal, Link2
} from "lucide-react";

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
            <p>Each client company gets its own Account. Accounts are the top-level tenant in the system — all websites, pages, users, and settings live inside one.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Accounts</strong> and click <strong>Create Account</strong>.</li>
              <li>Give it the client's company name, a URL-safe slug, and choose a plan (Starter / Pro / Enterprise).</li>
              <li>The account starts in <em>Active</em> status.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>SpotOn Results is already set up as the first account. For new SaaS clients, create a new account for each one.</span>
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
            <p>Each account can have one or more websites. A website maps to a real domain and holds all of its published pages.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Websites</strong> → <strong>Add Website</strong>.</li>
              <li>Enter the client's domain (e.g. <code>www.spotonresults.com</code>).</li>
              <li>Select the Account it belongs to.</li>
              <li>Optionally link a Brand Profile immediately, or do it after creating one.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>The domain you enter here is used in page canonical URLs and served content. Make sure it matches the client's actual domain exactly.</span>
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
            <p>The brand profile controls how published pages look and sound — colors, phone number, tagline, and description all flow from here into every generated page.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Brand Profiles</strong> → <strong>New Brand Profile</strong>.</li>
              <li>Enter the business name, primary color (hex), phone number, and tagline.</li>
              <li>Write a short brand description — Claude uses this for tone matching.</li>
              <li>Go back to <strong>Websites</strong> and link this profile to the website.</li>
            </ul>
          </div>
        ),
      },
      {
        num: "4",
        icon: MapPin,
        title: "Add Locations",
        where: "Platform → Locations",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Locations are the geographic targets for page generation. You can add states, cities, neighborhoods, or counties. Pages are created for every location × service combination you select when running a job.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Locations</strong> → <strong>Add Location</strong>.</li>
              <li>Choose a type: <em>State</em> or <em>City</em> (cities generate the most pages).</li>
              <li>Enter name, slug, and state code. For cities, also enter the parent state name.</li>
              <li>Add as many locations as needed — the system handles 100k+ pages.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>Start with <strong>states</strong> for state-hub pages, then add individual <strong>cities</strong> for city-level service pages. Both can coexist in the same job.</span>
            </div>
          </div>
        ),
      },
      {
        num: "5",
        icon: Wrench,
        title: "Add Services",
        where: "Platform → Services",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Services define what the business offers. Each service becomes a dimension of page generation — a 5-location × 3-service job produces 15 pages.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Services</strong> → <strong>Add Service</strong>.</li>
              <li>Enter name, slug, and a brief description.</li>
              <li>Add 4–6 keywords — the primary keyword (first one) is used most prominently by Claude.</li>
              <li>Use <strong>AI Suggest</strong> to have Claude generate a full list of services based on the business type.</li>
            </ul>
          </div>
        ),
      },
      {
        num: "6",
        icon: Layers,
        title: "Create a Blueprint",
        where: "Platform → Blueprints",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Blueprints are the templates Claude follows when generating pages. They define title/H1/meta patterns, required sections, word count, and QA thresholds.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Go to <strong>Blueprints</strong> → <strong>New Blueprint</strong>.</li>
              <li>Choose a page type: <em>Service + City</em>, <em>State Hub</em>, <em>City Hub</em>, etc.</li>
              <li>Use <strong>AI Generate</strong> to have Claude draft the whole blueprint, then review and adjust.</li>
              <li>Template variables you can use: <code>{"{service}"}</code>, <code>{"{location}"}</code>, <code>{"{state}"}</code>, <code>{"{brand}"}</code></li>
              <li>Set <strong>Min Publish Score</strong> (0.60–0.75) and <strong>Min Local Signal</strong> (0.50–0.65) — pages below these thresholds go to Draft Review instead of auto-publishing.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-700">
              <CheckCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>One blueprint per page type is typical. You might have a "Service + City" blueprint and a "State Hub" blueprint, and run separate jobs for each.</span>
            </div>
          </div>
        ),
      },
    ],
  },
  {
    label: "Content Generation",
    color: "bg-blue-500",
    steps: [
      {
        num: "7",
        icon: Zap,
        title: "Run a Generation Job",
        where: "Content → Generation Jobs",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>A generation job is the engine of the platform. It takes a blueprint + locations + services and has Claude AI write one page per combination.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Click <strong>New Job</strong> and select Account, Website, and Blueprint.</li>
              <li>Select which locations and services to include. The counter shows how many pages will be generated.</li>
              <li>Click <strong>Start Job</strong> — generation runs in the background. Each page takes 3–5 seconds.</li>
              <li>Watch the progress bar: <em>passed</em> = auto-published, <em>failed</em> = went to Draft Review or had an error.</li>
            </ul>
            <div className="mt-3 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Terminal className="size-3" />Generation Flow
              </div>
              <div className="p-3 space-y-1.5 text-xs">
                {[
                  ["Claude First Pass", "Full page written to spec"],
                  ["Rule QA", "Word count, scores, title/H1/meta checks"],
                  ["Adversarial Review", "Second Claude call grades quality"],
                  ["QA Pass → Auto-publish", "Page goes live immediately"],
                  ["QA Fail → Draft", "Page sent to Draft Review for you to decide"],
                ].map(([step, desc], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="size-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">{i + 1}</span>
                    <div><span className="font-medium text-foreground">{step}</span><span className="text-muted-foreground"> — {desc}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2 mt-1 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>If you see many failures, click <strong>"Show errors"</strong> on the job card to see the exact error per page. Common causes: rate limits (retry automatically), content too thin, or score below threshold.</span>
            </div>
          </div>
        ),
      },
      {
        num: "8",
        icon: FileText,
        title: "Review Drafts (Failed QA)",
        where: "Content → Draft Review",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Pages that didn't meet the QA thresholds land here for manual review. You can read the content and QA report, then decide to publish it anyway or prune it.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Select a website to load its draft pages.</li>
              <li>Click <strong>Preview</strong> to read the full content, meta data, and QA report.</li>
              <li>Click <strong>Publish</strong> to push the page live despite failing QA.</li>
              <li>Click <strong>Prune</strong> to discard it — it won't be shown again.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-50 border border-blue-100 text-blue-700">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>QA issues often mean the content is slightly below word count or lacks local detail. Many of these pages are still publishable — review and use your judgment.</span>
            </div>
          </div>
        ),
      },
      {
        num: "9",
        icon: CheckCircle,
        title: "Monitor Published Pages",
        where: "Content → Published Pages",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>The Published Pages view shows every live page for a selected website with its quality scores, page type, and platform URL.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Select a website to load its published pages.</li>
              <li>Each page shows its platform URL — click the copy button or open link to preview the rendered page.</li>
              <li>The <strong>Publish All</strong> button will push any remaining draft pages live in bulk.</li>
            </ul>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-700">
              <Link2 className="size-3.5 shrink-0 mt-0.5" />
              <span>Pages are served at <code>/sites/{"{"}{`domain`}{"}"}/{"{"}{`slug`}{"}"}</code> on this platform. For the page to appear at the client's actual domain, DNS must be configured (see step 11).</span>
            </div>
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
            <p>XML sitemaps tell search engines about all published pages so they get crawled and indexed faster.</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Select a website and click <strong>Generate Sitemaps</strong>.</li>
              <li>The system creates paginated sitemap files (up to 50,000 URLs each) and a sitemap index.</li>
              <li>Click <strong>View Sitemap Index</strong> to see the raw XML — submit this URL to Google Search Console.</li>
              <li>Re-generate sitemaps after each large job run to include new pages.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    label: "Client DNS Setup",
    color: "bg-emerald-500",
    steps: [
      {
        num: "11",
        icon: Globe,
        title: "Point the Client's Domain",
        where: "Client's DNS provider",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>For pages to be served under the client's own domain (instead of the platform URL), the client must add a DNS record pointing to this platform.</p>
            <div className="mt-2 rounded-md border overflow-hidden">
              <div className="bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Terminal className="size-3" />DNS Record (CNAME)
              </div>
              <div className="p-3 font-mono text-xs space-y-1 bg-zinc-950 text-zinc-200">
                <div><span className="text-zinc-400">Type:</span> CNAME</div>
                <div><span className="text-zinc-400">Name:</span> local  <span className="text-zinc-500">(subdomain only, e.g. "local" for local.spotonresults.com)</span></div>
                <div><span className="text-zinc-400">Value:</span> sospages.replit.app</div>
                <div><span className="text-zinc-400">TTL:</span> 300</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Once the CNAME propagates (usually 5–30 min), the client's domain will serve pages directly from this platform. No code changes needed.</p>
            <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span>The client's main website can continue running on its existing host — only the paths under <code>/sites/</code> route through this platform. A reverse proxy (Cloudflare Worker or nginx) on the client side may be needed for seamless integration.</span>
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
        where: "Content → Users & Roles",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Control who can access the platform and what they can do.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { role: "Super Admin", desc: "Full access to all accounts and platform settings. Can create/manage any account." },
                { role: "Account Admin", desc: "Full access within their own account — can manage websites, jobs, and their own users." },
                { role: "Editor", desc: "Can run jobs, review drafts, and publish pages within their account." },
                { role: "Viewer", desc: "Read-only access — can see pages, jobs, and stats but cannot make changes." },
              ].map(({ role, desc }) => (
                <div key={role} className="border rounded-md p-2.5 space-y-0.5">
                  <div className="text-xs font-semibold text-foreground">{role}</div>
                  <div className="text-xs">{desc}</div>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2">Click <strong>Create User</strong> to add a new user. Assign them an account and role. Default password is <code>changeme</code> — remind users to update it on first login.</p>
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
            <p>Once everything is set up, a typical monthly operating cycle looks like this:</p>
            <div className="space-y-2 mt-2">
              {[
                { freq: "Weekly", action: "Run a generation job for new location/service combinations. Check the Draft Review queue and publish or prune." },
                { freq: "After each job", action: "Regenerate sitemaps so new pages are indexed by Google." },
                { freq: "Monthly", action: "Check published page counts vs. targets. Review quality scores in the Published Pages view." },
                { freq: "As needed", action: "Add new locations or services, create new blueprints for new page types." },
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

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const Icon = step.icon;
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <button
        type="button"
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

export default function GuidePage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations Guide</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Step-by-step instructions for setting up accounts and generating white-pages content at scale.
          </p>
        </div>

        {/* Quick-reference flow */}
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Full Workflow at a Glance</div>
          <div className="flex flex-wrap gap-2 items-center text-xs">
            {[
              "Account", "Website", "Brand Profile", "Locations", "Services",
              "Blueprint", "Generation Job", "Draft Review", "Published", "Sitemap",
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

        <div className="text-center text-xs text-muted-foreground py-4 border-t">
          Nexus White-Pages Platform · Built for SpotOn Results · SaaS-ready
        </div>
      </div>
    </DashboardLayout>
  );
}
