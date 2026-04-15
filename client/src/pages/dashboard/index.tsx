import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, FileText, Activity, Zap, Building2, CheckCircle, AlertCircle, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    queryFn: () => api.get<any>("/api/dashboard/stats"),
    refetchInterval: 300000,
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ["/api/dashboard/activity"],
    queryFn: () => api.get<any>("/api/dashboard/activity"),
    refetchInterval: 120000,
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Platform health and metrics at a glance.</p>
          </div>
          <Link href="/jobs">
            <a>
              <Button className="gap-2" size="sm" data-testid="button-new-job">
                <Zap className="size-4" />
                New Generation Job
              </Button>
            </a>
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Accounts", value: stats?.totalAccounts, icon: Building2, color: "text-violet-500" },
            { label: "Websites", value: stats?.totalWebsites, icon: Globe, color: "text-blue-500" },
            { label: "Published", value: stats?.publishedPages, icon: CheckCircle, color: "text-emerald-500" },
            { label: "Failed QA", value: stats?.draftPages, icon: AlertCircle, color: "text-amber-500" },
            { label: "Active Jobs", value: stats?.activeJobs, icon: Activity, color: "text-red-500" },
          ].map((stat) => (
            <Card key={stat.label} className="xl:col-span-1">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium">{stat.label}</span>
                  <stat.icon className={`size-4 ${stat.color}`} />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{stat.value?.toLocaleString() ?? "—"}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Recent Jobs */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Recent Generation Jobs</CardTitle>
                  <Link href="/jobs">
                    <a className="text-xs text-primary hover:underline">View all</a>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                {activityLoading ? (
                  <div className="space-y-3">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : activity?.recentJobs?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No generation jobs yet. Create one to get started.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activity?.recentJobs?.slice(0, 5).map((job: any) => (
                      <div key={job.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                        <div className={`size-2 rounded-full shrink-0 ${
                          job.status === "completed" ? "bg-emerald-500" :
                          job.status === "running" ? "bg-blue-500 animate-pulse" :
                          job.status === "failed" ? "bg-destructive" :
                          "bg-muted-foreground"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{job.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {Math.min(job.processedPages, job.totalPages)}/{job.totalPages} pages · {Math.min(job.passedPages, job.totalPages)} passed
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-xs ${
                          job.status === "completed" ? "border-emerald-200 text-emerald-700" :
                          job.status === "running" ? "border-blue-200 text-blue-700" :
                          job.status === "failed" ? "border-red-200 text-red-700" : ""
                        }`}>
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Pages */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Pages</CardTitle>
                <Link href="/drafts">
                  <a className="text-xs text-primary hover:underline">Review</a>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : (
                <div className="space-y-2">
                  {activity?.recentPages?.slice(0, 6).map((page: any) => (
                    <div key={page.id} className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
                      <div className={`size-1.5 rounded-full mt-1.5 shrink-0 ${
                        page.status === "published" ? "bg-emerald-500" :
                        page.status === "review" ? "bg-amber-500" :
                        page.status === "approved" ? "bg-blue-500" :
                        "bg-muted-foreground"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{page.title}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{page.status} · {page.pageType?.replace("_", " ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { title: "New Generation Job", desc: "Generate pages with Claude AI", href: "/jobs", icon: Zap, color: "from-blue-500/10" },
            { title: "Review Drafts", desc: `${stats?.draftPages || 0} failed-QA pages to review`, href: "/drafts", icon: FileText, color: "from-amber-500/10" },
            { title: "Published Pages", desc: `${stats?.publishedPages || 0} pages live`, href: "/published", icon: CheckCircle, color: "from-emerald-500/10" },
            { title: "Manage Sitemaps", desc: "Generate & export sitemaps", href: "/sitemaps", icon: BarChart3, color: "from-violet-500/10" },
          ].map((action) => (
            <Link key={action.title} href={action.href}>
              <a>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer bg-gradient-to-br from-muted/30">
                  <CardContent className="p-4">
                    <action.icon className="size-5 text-primary mb-2" />
                    <div className="font-medium text-sm">{action.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{action.desc}</div>
                  </CardContent>
                </Card>
              </a>
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
