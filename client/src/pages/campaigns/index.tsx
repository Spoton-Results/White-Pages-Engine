import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Play, Pause, FileText, BarChart3, Settings2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const campaigns = [
  { 
    id: "camp_1", 
    name: "Atlanta Plumbing (Cities)", 
    account: "Acme Corp", 
    status: "Running", 
    progress: 45, 
    generated: "450", 
    total: "1,000",
    blueprint: "Local Service Alpha"
  },
  { 
    id: "camp_2", 
    name: "Dallas HVAC (Counties)", 
    account: "Global Services", 
    status: "Completed", 
    progress: 100, 
    generated: "840", 
    total: "840",
    blueprint: "County Aggregator"
  },
  { 
    id: "camp_3", 
    name: "NYC Pest Control (Neighborhoods)", 
    account: "National HVAC", 
    status: "Paused", 
    progress: 12, 
    generated: "420", 
    total: "3,500",
    blueprint: "Hyper-Local Content"
  },
];

export default function CampaignsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
            <p className="text-muted-foreground mt-1">Configure and monitor page generation workflows.</p>
          </div>
          <Button className="gap-2">
            <Plus className="size-4" />
            New Campaign
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search campaigns..." className="pl-9" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2"><Settings2 className="size-4" /> Blueprints</Button>
          </div>
        </div>

        <div className="grid gap-4">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="overflow-hidden hover:border-primary/50 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row items-center p-6 gap-6">
                  <div className="flex-1 w-full flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold">{campaign.name}</h3>
                        <Badge variant="secondary" className={
                          campaign.status === "Running" ? "bg-primary/10 text-primary" :
                          campaign.status === "Completed" ? "bg-emerald-500/10 text-emerald-500" :
                          "bg-amber-500/10 text-amber-500"
                        }>
                          {campaign.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{campaign.account}</div>
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <FileText className="size-4" />
                      Blueprint: <span className="font-medium text-foreground">{campaign.blueprint}</span>
                    </div>
                    
                    <div className="mt-4 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Generation Progress</span>
                        <span className="font-medium">{campaign.generated} / {campaign.total} pages</span>
                      </div>
                      <Progress value={campaign.progress} className="h-2" />
                    </div>
                  </div>
                  
                  <div className="flex md:flex-col gap-2 w-full md:w-auto shrink-0 md:border-l md:pl-6">
                    {campaign.status === "Running" ? (
                      <Button variant="outline" className="w-full gap-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50">
                        <Pause className="size-4" /> Pause
                      </Button>
                    ) : (
                      <Button variant="outline" className="w-full gap-2 text-primary hover:text-primary hover:bg-primary/10">
                        <Play className="size-4" /> {campaign.status === "Completed" ? "Restart" : "Resume"}
                      </Button>
                    )}
                    <Button variant="ghost" className="w-full gap-2">
                      <BarChart3 className="size-4" /> Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}