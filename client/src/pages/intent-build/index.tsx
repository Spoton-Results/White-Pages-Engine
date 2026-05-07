import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Layers,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  Target,
} from "lucide-react";

type BuildStatus = "idle" | "running" | "complete" | "failed";

interface WebsiteOption {
  id: string;
  name: string;
  domain: string;
}

interface CanonicalOwner {
  canonicalOwner: string;
  intentCluster: string;
  pagesOwned: number;
  strength: "Strong" | "Medium" | "Weak";
  risk: "Low" | "Medium" | "High";
  recommendedAction: string;
}

const websites: WebsiteOption[] = [
  {
    id: "spoton-results",
    name: "SpotOn Results",
    domain: "spotonresults.com",
  },
  {
    id: "subdraw",
    name: "Subdraw",
    domain: "pages.subdraw.com",
  },
  {
    id: "subtracker",
    name: "SubTracker",
    domain: "subtrackers.spotonresults.com",
  },
];

const mockOwners: CanonicalOwner[] = [
  {
    canonicalOwner: "/pages/hvac-services-austin-tx",
    intentCluster: "HVAC Services + City",
    pagesOwned: 42,
    strength: "Strong",
    risk: "Low",
    recommendedAction: "Promote as primary city-service owner",
  },
  {
    canonicalOwner: "/pages/plumbing-services-phoenix-az",
    intentCluster: "Plumbing Services + City",
    pagesOwned: 36,
    strength: "Strong",
    risk: "Low",
    recommendedAction: "Expand supporting internal links",
  },
  {
    canonicalOwner: "/pages/electrical-contractor-dallas-tx",
    intentCluster: "Electrical Contractor + City",
    pagesOwned: 29,
    strength: "Medium",
    risk: "Medium",
    recommendedAction: "Consolidate overlapping service variants",
  },
  {
    canonicalOwner: "/pages/roofing-companies-denver-co",
    intentCluster: "Roofing Companies + Local",
    pagesOwned: 18,
    strength: "Medium",
    risk: "Medium",
    recommendedAction: "Add hub support and improve anchor diversity",
  },
  {
    canonicalOwner: "/pages/general-contractor-miami-fl",
    intentCluster: "GC + City + Service",
    pagesOwned: 11,
    strength: "Weak",
    risk: "High",
    recommendedAction: "Assign clear canonical owner and merge duplicates",
  },
];

const buildSteps = [
  "Scanning published pages",
  "Grouping pages by search intent",
  "Finding canonical owners",
  "Checking overlap and cannibalization",
  "Scoring owner strength",
  "Preparing final recommendations",
];

function getStrengthBadge(strength: CanonicalOwner["strength"]) {
  if (strength === "Strong") {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Strong</Badge>;
  }

  if (strength === "Medium") {
    return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Medium</Badge>;
  }

  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Weak</Badge>;
}

function getRiskBadge(risk: CanonicalOwner["risk"]) {
  if (risk === "Low") {
    return <Badge variant="outline" className="border-green-200 text-green-700">Low</Badge>;
  }

  if (risk === "Medium") {
    return <Badge variant="outline" className="border-yellow-200 text-yellow-700">Medium</Badge>;
  }

  return <Badge variant="outline" className="border-red-200 text-red-700">High</Badge>;
}

export default function IntentBuildPage() {
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>("spoton-results");
  const [status, setStatus] = useState<BuildStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  const [lastRunTime, setLastRunTime] = useState<string>("Never");

  const selectedWebsite = useMemo(
    () => websites.find((website) => website.id === selectedWebsiteId) ?? websites[0],
    [selectedWebsiteId],
  );

  const currentStep = buildSteps[currentStepIndex] ?? buildSteps[0];

  const report = {
    totalPagesAnalyzed: 12480,
    canonicalOwnersFound: 842,
    orphanIntentGroups: 67,
    duplicateOverlapRisks: 43,
    weakOwnerClusters: 118,
    promotionCandidates: 214,
    coveragePercentage: 86,
    strongOwners: 512,
    mediumOwners: 212,
    weakOwners: 118,
    missingCanonicalOwners: 67,
  };

  function handleRunBuild() {
    if (status === "running") return;

    setStatus("running");
    setHasRun(true);
    setProgress(0);
    setCurrentStepIndex(0);

    let nextProgress = 0;
    let nextStep = 0;

    const timer = window.setInterval(() => {
      nextProgress += 17;
      nextStep = Math.min(Math.floor(nextProgress / 17), buildSteps.length - 1);

      setProgress(Math.min(nextProgress, 100));
      setCurrentStepIndex(nextStep);

      if (nextProgress >= 100) {
        window.clearInterval(timer);
        setProgress(100);
        setCurrentStepIndex(buildSteps.length - 1);
        setStatus("complete");
        setLastRunTime(new Date().toLocaleString());
      }
    }, 550);
  }

  function handleRefresh() {
    if (status === "running") return;

    if (!hasRun) {
      setStatus("idle");
      setProgress(0);
      setCurrentStepIndex(0);
      return;
    }

    setLastRunTime(new Date().toLocaleString());
  }

  const completedCount = status === "complete" ? buildSteps.length : currentStepIndex + 1;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                <Target className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Intent Ownership Build
              </h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">
              Map canonical owners, semantic gaps, duplicate overlap, and weak ownership clusters
              across a selected website before pages are promoted, merged, expanded, or linked.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={selectedWebsiteId} onValueChange={setSelectedWebsiteId}>
              <SelectTrigger className="w-full sm:w-[280px]" data-testid="select-website">
                <SelectValue placeholder="Select website" />
              </SelectTrigger>
              <SelectContent>
                {websites.map((website) => (
                  <SelectItem key={website.id} value={website.id}>
                    {website.name} — {website.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={handleRunBuild}
              disabled={status === "running"}
              data-testid="btn-run-build"
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              {status === "running" ? "Running..." : "Run Build"}
            </Button>

            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={status === "running"}
              data-testid="btn-refresh"
              className="gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="h-4 w-4 text-gray-500" />
                  Build Status
                </CardTitle>
                <CardDescription>
                  Current run state for {selectedWebsite.name} ({selectedWebsite.domain})
                </CardDescription>
              </div>

              <Badge
                className={
                  status === "complete"
                    ? "bg-green-100 text-green-800 hover:bg-green-100"
                    : status === "running"
                      ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                      : status === "failed"
                        ? "bg-red-100 text-red-800 hover:bg-red-100"
                        : "bg-gray-100 text-gray-800 hover:bg-gray-100"
                }
              >
                {status.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
                <p className="mt-1 text-lg font-semibold capitalize text-gray-900">{status}</p>
              </div>

              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last Run</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{lastRunTime}</p>
              </div>

              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Website</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{selectedWebsite.domain}</p>
              </div>

              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pages Analyzed</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {hasRun ? report.totalPagesAnalyzed.toLocaleString() : "0"}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">
                  {status === "running" ? currentStep : hasRun ? "Build complete" : "Waiting to run"}
                </span>
                <span className="text-gray-500">
                  {completedCount} / {buildSteps.length}
                </span>
              </div>
              <Progress value={progress} />
            </div>
          </CardContent>
        </Card>

        {!hasRun && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="rounded-full bg-blue-50 p-4 text-blue-700">
                <Search className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                No Intent Ownership Build has been run yet
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-500">
                Select a website and run the build to identify which pages own each search intent,
                where overlap exists, which clusters are weak, and which pages should be promoted
                or consolidated.
              </p>
              <Button onClick={handleRunBuild} className="mt-5 gap-2">
                <Play className="h-4 w-4" />
                Run First Build
              </Button>
            </CardContent>
          </Card>
        )}

        {hasRun && (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <Card>
                <CardContent className="p-4">
                  <Database className="h-5 w-5 text-blue-600" />
                  <p className="mt-3 text-2xl font-bold">{report.totalPagesAnalyzed.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Total pages analyzed</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                  <p className="mt-3 text-2xl font-bold">{report.canonicalOwnersFound.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Canonical owners found</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <GitBranch className="h-5 w-5 text-orange-600" />
                  <p className="mt-3 text-2xl font-bold">{report.orphanIntentGroups}</p>
                  <p className="text-xs text-gray-500">Orphan intent groups</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <p className="mt-3 text-2xl font-bold">{report.duplicateOverlapRisks}</p>
                  <p className="text-xs text-gray-500">Duplicate overlap risks</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <Layers className="h-5 w-5 text-yellow-600" />
                  <p className="mt-3 text-2xl font-bold">{report.weakOwnerClusters}</p>
                  <p className="text-xs text-gray-500">Weak owner clusters</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <BarChart3 className="h-5 w-5 text-purple-600" />
                  <p className="mt-3 text-2xl font-bold">{report.promotionCandidates}</p>
                  <p className="text-xs text-gray-500">Promotion candidates</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">Owner Coverage Summary</CardTitle>
                  <CardDescription>
                    How much of the site has clear canonical ownership.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">Coverage</span>
                      <span className="font-bold text-gray-900">{report.coveragePercentage}%</span>
                    </div>
                    <Progress value={report.coveragePercentage} className="mt-2" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-xl font-bold text-green-700">{report.strongOwners}</p>
                      <p className="text-xs text-gray-500">Strong owners</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xl font-bold text-yellow-700">{report.mediumOwners}</p>
                      <p className="text-xs text-gray-500">Medium owners</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xl font-bold text-red-700">{report.weakOwners}</p>
                      <p className="text-xs text-gray-500">Weak owners</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xl font-bold text-orange-700">{report.missingCanonicalOwners}</p>
                      <p className="text-xs text-gray-500">Missing owners</p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
                    <div className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p>
                        Best next move: promote strong owners, link medium owners from hubs,
                        and consolidate weak duplicate clusters.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Top Canonical Owners</CardTitle>
                  <CardDescription>
                    Mock ownership table. Backend wiring comes after the UI is approved.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Canonical Owner</TableHead>
                          <TableHead>Intent Cluster</TableHead>
                          <TableHead className="text-right">Pages Owned</TableHead>
                          <TableHead>Strength</TableHead>
                          <TableHead>Risk</TableHead>
                          <TableHead>Recommended Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mockOwners.map((owner) => (
                          <TableRow key={owner.canonicalOwner}>
                            <TableCell className="max-w-[220px] truncate font-medium">
                              {owner.canonicalOwner}
                            </TableCell>
                            <TableCell>{owner.intentCluster}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {owner.pagesOwned}
                            </TableCell>
                            <TableCell>{getStrengthBadge(owner.strength)}</TableCell>
                            <TableCell>{getRiskBadge(owner.risk)}</TableCell>
                            <TableCell className="text-sm text-gray-600">
                              {owner.recommendedAction}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}