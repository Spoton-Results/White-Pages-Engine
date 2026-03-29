import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  Globe, 
  FileText, 
  ArrowUpRight, 
  Activity,
  Zap
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const data = [
  { name: "Jan", total: 1200 },
  { name: "Feb", total: 2100 },
  { name: "Mar", total: 1800 },
  { name: "Apr", total: 2400 },
  { name: "May", total: 2800 },
  { name: "Jun", total: 3200 },
  { name: "Jul", total: 4100 },
];

export default function Dashboard() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
            <p className="text-muted-foreground mt-1">Platform performance and system metrics.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline">Download Report</Button>
            <Button className="gap-2">
              <Zap className="size-4" />
              New Generation Task
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pages Generated</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">104,231</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <span className="text-emerald-500 flex items-center"><ArrowUpRight className="size-3" /> +12.5%</span> from last month
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Accounts</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">42</div>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <span className="text-emerald-500 flex items-center"><ArrowUpRight className="size-3" /> +4</span> new this week
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Managed Websites</CardTitle>
              <Globe className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">128</div>
              <p className="text-xs text-muted-foreground mt-1">Across 42 custom domains</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">API Usage (Claude)</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">1.2M <span className="text-sm text-muted-foreground font-normal">tokens</span></div>
              <p className="text-xs text-muted-foreground mt-1">85% of monthly quota</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Generation Velocity</CardTitle>
              <CardDescription>
                Pages generated and published over time.
              </CardDescription>
            </CardHeader>
            <CardContent className="pl-0">
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="name" 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12} 
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))" 
                      fontSize={12} 
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Latest platform events across all accounts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                {[
                  { title: "Batch generation completed", desc: "Generated 5,000 pages for 'Plumbing Services' campaign.", time: "10 min ago", color: "text-emerald-500", bg: "bg-emerald-500/10" },
                  { title: "Sitemap exported to R2", desc: "Sitemap index updated for domain example.com.", time: "45 min ago", color: "text-blue-500", bg: "bg-blue-500/10" },
                  { title: "New account provisioned", desc: "Account 'Acme Corp' created successfully.", time: "2 hours ago", color: "text-purple-500", bg: "bg-purple-500/10" },
                  { title: "Semantic similarity check", desc: "Flagged 24 pages for review in 'HVAC Local' campaign.", time: "4 hours ago", color: "text-amber-500", bg: "bg-amber-500/10" },
                  { title: "Pages published", desc: "Deployed 1,200 pages to Cloudflare Pages.", time: "5 hours ago", color: "text-emerald-500", bg: "bg-emerald-500/10" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className={`mt-0.5 size-2 rounded-full ${item.color} ${item.bg} ring-4 ring-background`} />
                    <div className="grid gap-1 flex-1">
                      <p className="text-sm font-medium leading-none">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">{item.time}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}