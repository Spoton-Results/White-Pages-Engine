import { db } from "./db";
import { hashPassword } from "./auth";
import * as storage from "./storage";
import {
  accounts, users, brandProfiles, websites, locations, services, industries,
  queryClusters, blueprints, pages, pageVersions, generationJobs,
} from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  console.log("Seeding database...");

  // Check if already seeded
  const existingAccounts = await storage.getAccounts();
  if (existingAccounts.length > 0) {
    console.log("Database already seeded, skipping.");
    return;
  }

  // ── Super Admin User ──────────────────────────────────────────────────────
  const superAdmin = await storage.createUser({
    accountId: null,
    username: "admin",
    email: "admin@nexus.io",
    password: await hashPassword("admin123"),
    role: "super_admin",
    isSuperAdmin: true,
  });
  console.log("Created super admin:", superAdmin.email);

  // ── Account 1: Acme Plumbing ──────────────────────────────────────────────
  const acme = await storage.createAccount({
    name: "Acme Plumbing Co",
    slug: "acme-plumbing",
    plan: "enterprise",
    status: "active",
  });

  const acmeBrand = await storage.createBrandProfile({
    accountId: acme.id,
    name: "Acme Plumbing Co",
    tagline: "Atlanta's Most Trusted Plumbers",
    description: "Family-owned plumbing company serving metro Atlanta since 1998. Licensed, bonded, and insured with 24/7 emergency service.",
    phone: "(404) 555-0100",
    email: "info@acmeplumbing.com",
    address: "123 Main St, Atlanta, GA 30301",
    primaryColor: "#1e3a5f",
    secondaryColor: "#f59e0b",
    voiceAndTone: "Trustworthy, professional, community-focused. Use first names and direct language.",
  });

  const acmeWebsite = await storage.createWebsite({
    accountId: acme.id,
    brandProfileId: acmeBrand.id,
    name: "Acme Plumbing Atlanta",
    domain: "acmeplumbing-atlanta.com",
    status: "live",
    primaryIndustry: "plumbing",
    r2Prefix: "acme-plumbing",
    settings: { enableFaq: true, generateSchema: true },
  });

  await storage.createUser({
    accountId: acme.id,
    username: "acme_admin",
    email: "admin@acmeplumbing.com",
    password: await hashPassword("password123"),
    role: "account_admin",
    isSuperAdmin: false,
  });

  // ── Account 2: National HVAC ──────────────────────────────────────────────
  const national = await storage.createAccount({
    name: "National HVAC Group",
    slug: "national-hvac",
    plan: "enterprise",
    status: "active",
  });

  const nationalBrand = await storage.createBrandProfile({
    accountId: national.id,
    name: "National HVAC Group",
    tagline: "Comfort Delivered Nationwide",
    description: "The nation's premier HVAC service network with locations in 30+ states.",
    phone: "(800) 555-0200",
    email: "info@nationalhvac.com",
    primaryColor: "#dc2626",
    secondaryColor: "#1e40af",
  });

  const nationalWebsite = await storage.createWebsite({
    accountId: national.id,
    brandProfileId: nationalBrand.id,
    name: "National HVAC Main",
    domain: "national-hvac-pros.com",
    status: "live",
    primaryIndustry: "hvac",
    r2Prefix: "national-hvac",
  });

  // ── Industries ─────────────────────────────────────────────────────────────
  const plumbingIndustry = await storage.createIndustry({
    accountId: acme.id,
    name: "Plumbing",
    slug: "plumbing",
    description: "Residential and commercial plumbing services",
    naicsCode: "238220",
  });

  const hvacIndustry = await storage.createIndustry({
    accountId: national.id,
    name: "HVAC",
    slug: "hvac",
    description: "Heating, ventilation, and air conditioning",
    naicsCode: "238220",
  });

  // ── Services ───────────────────────────────────────────────────────────────
  const services_data = [
    { name: "Emergency Plumbing", slug: "emergency-plumbing", keywords: ["emergency plumber", "24 hour plumber", "plumber near me"], accountId: acme.id, industryId: plumbingIndustry.id },
    { name: "Drain Cleaning", slug: "drain-cleaning", keywords: ["drain cleaning", "clogged drain", "drain unclogging"], accountId: acme.id, industryId: plumbingIndustry.id },
    { name: "Water Heater Installation", slug: "water-heater-installation", keywords: ["water heater installation", "hot water heater", "tankless water heater"], accountId: acme.id, industryId: plumbingIndustry.id },
    { name: "Pipe Repair", slug: "pipe-repair", keywords: ["pipe repair", "burst pipe", "leaking pipe"], accountId: acme.id, industryId: plumbingIndustry.id },
    { name: "AC Repair", slug: "ac-repair", keywords: ["ac repair", "air conditioner repair", "ac not cooling"], accountId: national.id, industryId: hvacIndustry.id },
    { name: "Furnace Installation", slug: "furnace-installation", keywords: ["furnace installation", "new furnace", "furnace replacement"], accountId: national.id, industryId: hvacIndustry.id },
  ];

  const createdServices: any[] = [];
  for (const svc of services_data) {
    const created = await storage.createService(svc);
    createdServices.push(created);
  }

  // ── Locations (Georgia cities for Acme) ────────────────────────────────────
  const locations_data = [
    { name: "Atlanta", slug: "atlanta", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 498715, accountId: acme.id },
    { name: "Marietta", slug: "marietta", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 60972, accountId: acme.id },
    { name: "Roswell", slug: "roswell", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 94763, accountId: acme.id },
    { name: "Alpharetta", slug: "alpharetta", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 67213, accountId: acme.id },
    { name: "Decatur", slug: "decatur", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 24981, accountId: acme.id },
    { name: "Sandy Springs", slug: "sandy-springs", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 110240, accountId: acme.id },
    { name: "Smyrna", slug: "smyrna", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 59885, accountId: acme.id },
    { name: "Lawrenceville", slug: "lawrenceville", type: "city" as const, stateCode: "GA", stateName: "Georgia", population: 30028, accountId: acme.id },
    { name: "Georgia", slug: "georgia", type: "state" as const, stateCode: "GA", stateName: "Georgia", accountId: acme.id },
    // National HVAC locations
    { name: "Dallas", slug: "dallas", type: "city" as const, stateCode: "TX", stateName: "Texas", population: 1304379, accountId: national.id },
    { name: "Houston", slug: "houston", type: "city" as const, stateCode: "TX", stateName: "Texas", population: 2304580, accountId: national.id },
    { name: "Austin", slug: "austin", type: "city" as const, stateCode: "TX", stateName: "Texas", population: 961855, accountId: national.id },
    { name: "Texas", slug: "texas", type: "state" as const, stateCode: "TX", stateName: "Texas", accountId: national.id },
  ];

  const createdLocations: any[] = [];
  for (const loc of locations_data) {
    const created = await storage.createLocation(loc);
    createdLocations.push(created);
  }

  // ── Query Clusters ─────────────────────────────────────────────────────────
  await storage.createQueryCluster({
    accountId: acme.id,
    serviceId: createdServices[0].id,
    name: "Emergency Plumber Intent",
    intentType: "transactional",
    primaryKeyword: "emergency plumber near me",
    secondaryKeywords: ["24 hour plumber", "plumber open now", "urgent plumber"],
    searchVolume: 8100,
    difficulty: 45,
  });

  await storage.createQueryCluster({
    accountId: acme.id,
    serviceId: createdServices[1].id,
    name: "Drain Cleaning Local",
    intentType: "local",
    primaryKeyword: "drain cleaning service",
    secondaryKeywords: ["drain unclogging", "plumber for clogged drain"],
    searchVolume: 5400,
    difficulty: 38,
  });

  // ── Blueprints ─────────────────────────────────────────────────────────────
  const serviceCityBlueprint = await storage.createBlueprint({
    accountId: acme.id,
    websiteId: acmeWebsite.id,
    name: "Service + City Page",
    pageType: "service_city",
    titleTemplate: "{service} in {location}, {state} | {brand}",
    metaDescTemplate: "Need {service} in {location}? {brand} provides fast, reliable service to {location} homeowners. Call now!",
    h1Template: "Professional {service} in {location}, {state}",
    slugTemplate: "{service}-{location}",
    requiredWordCount: 800,
    minPublishScore: "0.65",
    minLocalSignal: "0.55",
    maxSimilarityThreshold: "0.85",
    promptFamily: "local_service",
    faqEnabled: true,
    schemaTypes: ["LocalBusiness", "FAQPage"],
    sections: [
      { name: "Introduction", description: "Overview of the service in the specific city" },
      { name: "Our Services in {location}", description: "Detailed breakdown of what we offer locally" },
      { name: "Why Choose Us", description: "Brand differentiators and local trust signals" },
      { name: "Service Area", description: "Neighborhoods and areas we cover" },
      { name: "FAQ", description: "4-6 frequently asked questions about the service" },
      { name: "Contact & Call to Action", description: "Clear CTA with phone number and next steps" },
    ],
    isActive: true,
  });

  const stateHubBlueprint = await storage.createBlueprint({
    accountId: acme.id,
    websiteId: acmeWebsite.id,
    name: "State Hub Page",
    pageType: "state_hub",
    titleTemplate: "{service} Services in {state} | {brand}",
    metaDescTemplate: "Find the best {service} services in {state}. {brand} covers all major cities across {state} with licensed, insured professionals.",
    h1Template: "{service} Services Across {state}",
    slugTemplate: "{state}-{service}",
    requiredWordCount: 1000,
    minPublishScore: "0.70",
    minLocalSignal: "0.60",
    maxSimilarityThreshold: "0.80",
    promptFamily: "state_hub",
    faqEnabled: true,
    schemaTypes: ["Organization", "FAQPage"],
    sections: [
      { name: "Introduction", description: "Overview of services across the state" },
      { name: "Cities We Serve", description: "List and describe major service cities" },
      { name: "Why {brand} in {state}", description: "State-specific trust signals and credentials" },
      { name: "FAQ", description: "State-level FAQ" },
    ],
    isActive: true,
  });

  const hvacBlueprint = await storage.createBlueprint({
    accountId: national.id,
    websiteId: nationalWebsite.id,
    name: "HVAC Service + City",
    pageType: "service_city",
    titleTemplate: "{service} in {location}, {state} | National HVAC",
    metaDescTemplate: "Expert {service} in {location}. National HVAC Group provides same-day service to {location} residents. Licensed & insured.",
    h1Template: "{service} in {location} — Fast, Reliable, Affordable",
    slugTemplate: "{service}-{location}-{state}",
    requiredWordCount: 700,
    minPublishScore: "0.65",
    minLocalSignal: "0.55",
    maxSimilarityThreshold: "0.85",
    promptFamily: "local_service",
    faqEnabled: true,
    schemaTypes: ["LocalBusiness", "FAQPage"],
    sections: [
      { name: "Introduction", description: "HVAC service overview for specific city" },
      { name: "Our HVAC Services", description: "Detailed service breakdown" },
      { name: "Why Choose National HVAC", description: "Trust signals" },
      { name: "Service Area", description: "Coverage area" },
      { name: "FAQ", description: "FAQ section" },
    ],
    isActive: true,
  });

  // ── Sample Pages (pre-generated) ──────────────────────────────────────────
  const samplePagesData = [
    {
      websiteId: acmeWebsite.id,
      blueprintId: serviceCityBlueprint.id,
      locationId: createdLocations[0].id,
      serviceId: createdServices[0].id,
      pageType: "service_city" as const,
      slug: "emergency-plumbing-atlanta",
      title: "Emergency Plumbing in Atlanta, GA | Acme Plumbing Co",
      metaDescription: "Need emergency plumbing in Atlanta? Acme Plumbing Co provides fast, reliable 24/7 service to Atlanta homeowners. Call (404) 555-0100 now!",
      h1: "Professional Emergency Plumbing in Atlanta, Georgia",
      canonicalUrl: "https://acmeplumbing-atlanta.com/emergency-plumbing-atlanta",
      status: "published" as const,
      publishScore: "0.88",
      localSignalScore: "0.82",
      wordCount: 950,
      passedQa: true,
      publishedAt: new Date(),
    },
    {
      websiteId: acmeWebsite.id,
      blueprintId: serviceCityBlueprint.id,
      locationId: createdLocations[1].id,
      serviceId: createdServices[0].id,
      pageType: "service_city" as const,
      slug: "emergency-plumbing-marietta",
      title: "Emergency Plumbing in Marietta, GA | Acme Plumbing Co",
      metaDescription: "24/7 emergency plumbing in Marietta, GA. Licensed Acme Plumbing Co plumbers serving Marietta and surrounding areas. Fast response.",
      h1: "Emergency Plumbing Services in Marietta, Georgia",
      canonicalUrl: "https://acmeplumbing-atlanta.com/emergency-plumbing-marietta",
      status: "published" as const,
      publishScore: "0.84",
      localSignalScore: "0.78",
      wordCount: 880,
      passedQa: true,
      publishedAt: new Date(),
    },
    {
      websiteId: acmeWebsite.id,
      blueprintId: serviceCityBlueprint.id,
      locationId: createdLocations[2].id,
      serviceId: createdServices[1].id,
      pageType: "service_city" as const,
      slug: "drain-cleaning-roswell",
      title: "Drain Cleaning in Roswell, GA | Acme Plumbing Co",
      metaDescription: "Professional drain cleaning in Roswell, GA. Acme Plumbing clears clogged drains fast. Same-day service available.",
      h1: "Professional Drain Cleaning in Roswell, Georgia",
      canonicalUrl: "https://acmeplumbing-atlanta.com/drain-cleaning-roswell",
      status: "review" as const,
      publishScore: "0.79",
      localSignalScore: "0.71",
      wordCount: 820,
      passedQa: true,
    },
    {
      websiteId: acmeWebsite.id,
      blueprintId: serviceCityBlueprint.id,
      locationId: createdLocations[3].id,
      serviceId: createdServices[2].id,
      pageType: "service_city" as const,
      slug: "water-heater-installation-alpharetta",
      title: "Water Heater Installation in Alpharetta, GA | Acme Plumbing",
      metaDescription: "Expert water heater installation in Alpharetta. Traditional and tankless options. Acme Plumbing serves all of Alpharetta GA.",
      h1: "Water Heater Installation in Alpharetta, Georgia",
      canonicalUrl: "https://acmeplumbing-atlanta.com/water-heater-installation-alpharetta",
      status: "draft" as const,
      publishScore: "0.62",
      localSignalScore: "0.58",
      wordCount: 650,
      passedQa: false,
      qaReport: { issues: ["Word count below minimum 800", "Local signal score 0.58 below threshold 0.60"] },
    },
    {
      websiteId: nationalWebsite.id,
      blueprintId: hvacBlueprint.id,
      locationId: createdLocations[9].id,
      serviceId: createdServices[4].id,
      pageType: "service_city" as const,
      slug: "ac-repair-dallas-tx",
      title: "AC Repair in Dallas, TX | National HVAC Group",
      metaDescription: "Expert AC repair in Dallas. National HVAC Group provides same-day service to Dallas residents. Licensed & insured. Call now!",
      h1: "AC Repair in Dallas — Fast, Reliable, Affordable",
      canonicalUrl: "https://national-hvac-pros.com/ac-repair-dallas-tx",
      status: "published" as const,
      publishScore: "0.86",
      localSignalScore: "0.80",
      wordCount: 900,
      passedQa: true,
      publishedAt: new Date(),
    },
  ];

  const createdPages: any[] = [];
  for (const pageData of samplePagesData) {
    const page = await storage.createPage(pageData);
    createdPages.push(page);

    // Create a sample page version
    await storage.createPageVersion({
      pageId: page.id,
      version: 1,
      contentHtml: generateSampleHtml(page.h1, page.slug),
      isActive: true,
      promptTokens: 1200,
      completionTokens: 800,
      reviewNotes: "Initial generation",
    });
  }

  // Update published page counts
  await db.update(websites as any).set({ publishedPages: 2 }).where(eq((websites as any).id, acmeWebsite.id));
  await db.update(websites as any).set({ publishedPages: 1 }).where(eq((websites as any).id, nationalWebsite.id));

  // ── Sample Generation Job ──────────────────────────────────────────────────
  await storage.createGenerationJob({
    accountId: acme.id,
    websiteId: acmeWebsite.id,
    blueprintId: serviceCityBlueprint.id,
    name: "Atlanta Metro Plumbing - Full Run",
    status: "completed",
    totalPages: 32,
    processedPages: 32,
    passedPages: 28,
    failedPages: 4,
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    errorLog: [],
  });

  console.log("Seeding complete!");
  console.log("Super admin login: admin@nexus.io / admin123");
}

function generateSampleHtml(h1: string, slug: string): string {
  return `<article>
  <h1>${h1}</h1>
  <p>Welcome to our comprehensive service page. Our team of licensed professionals is ready to help you with all your needs in this area.</p>
  
  <h2>Our Services</h2>
  <p>We provide a full range of professional services to homeowners and businesses in this area. Our experienced technicians are available 24/7 for emergency situations.</p>
  <ul>
    <li>Same-day service available</li>
    <li>Licensed and insured technicians</li>
    <li>Upfront pricing — no hidden fees</li>
    <li>100% satisfaction guarantee</li>
  </ul>
  
  <h2>Why Choose Us</h2>
  <p>With over 25 years of experience, we've built a reputation for quality workmanship and outstanding customer service. Our team undergoes continuous training to stay current with the latest techniques and technologies.</p>
  
  <h2>Our Service Area</h2>
  <p>We serve all neighborhoods throughout this area and surrounding communities. No job is too big or too small — we handle everything from minor repairs to complete system installations.</p>
  
  <h2>Frequently Asked Questions</h2>
  <div class="faq">
    <h3>How quickly can you respond to an emergency?</h3>
    <p>We offer 24/7 emergency service and can typically have a technician at your location within 1-2 hours of your call.</p>
    
    <h3>Are your technicians licensed and insured?</h3>
    <p>Yes, all our technicians are fully licensed, bonded, and insured for your protection and peace of mind.</p>
    
    <h3>Do you offer free estimates?</h3>
    <p>We provide upfront, transparent pricing before any work begins. Call us today for a free estimate.</p>
  </div>
  
  <h2>Contact Us Today</h2>
  <p>Ready to get started? Call us now or fill out our online form to schedule your service. Our friendly team is standing by to help.</p>
</article>`;
}
