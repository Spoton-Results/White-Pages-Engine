import { db } from "../server/db";
import { hashPassword } from "../server/auth";
import * as storage from "../server/storage";

const US_STATES = [
  { name: "Alabama", code: "AL" }, { name: "Alaska", code: "AK" },
  { name: "Arizona", code: "AZ" }, { name: "Arkansas", code: "AR" },
  { name: "California", code: "CA" }, { name: "Colorado", code: "CO" },
  { name: "Connecticut", code: "CT" }, { name: "Delaware", code: "DE" },
  { name: "Florida", code: "FL" }, { name: "Georgia", code: "GA" },
  { name: "Hawaii", code: "HI" }, { name: "Idaho", code: "ID" },
  { name: "Illinois", code: "IL" }, { name: "Indiana", code: "IN" },
  { name: "Iowa", code: "IA" }, { name: "Kansas", code: "KS" },
  { name: "Kentucky", code: "KY" }, { name: "Louisiana", code: "LA" },
  { name: "Maine", code: "ME" }, { name: "Maryland", code: "MD" },
  { name: "Massachusetts", code: "MA" }, { name: "Michigan", code: "MI" },
  { name: "Minnesota", code: "MN" }, { name: "Mississippi", code: "MS" },
  { name: "Missouri", code: "MO" }, { name: "Montana", code: "MT" },
  { name: "Nebraska", code: "NE" }, { name: "Nevada", code: "NV" },
  { name: "New Hampshire", code: "NH" }, { name: "New Jersey", code: "NJ" },
  { name: "New Mexico", code: "NM" }, { name: "New York", code: "NY" },
  { name: "North Carolina", code: "NC" }, { name: "North Dakota", code: "ND" },
  { name: "Ohio", code: "OH" }, { name: "Oklahoma", code: "OK" },
  { name: "Oregon", code: "OR" }, { name: "Pennsylvania", code: "PA" },
  { name: "Rhode Island", code: "RI" }, { name: "South Carolina", code: "SC" },
  { name: "South Dakota", code: "SD" }, { name: "Tennessee", code: "TN" },
  { name: "Texas", code: "TX" }, { name: "Utah", code: "UT" },
  { name: "Vermont", code: "VT" }, { name: "Virginia", code: "VA" },
  { name: "Washington", code: "WA" }, { name: "West Virginia", code: "WV" },
  { name: "Wisconsin", code: "WI" }, { name: "Wyoming", code: "WY" },
];

const TOP_CITIES = [
  { name: "New York City", slug: "new-york-city", state: "New York", code: "NY", pop: 8336817 },
  { name: "Los Angeles", slug: "los-angeles", state: "California", code: "CA", pop: 3979576 },
  { name: "Chicago", slug: "chicago", state: "Illinois", code: "IL", pop: 2693976 },
  { name: "Houston", slug: "houston", state: "Texas", code: "TX", pop: 2304580 },
  { name: "Phoenix", slug: "phoenix", state: "Arizona", code: "AZ", pop: 1608139 },
  { name: "Philadelphia", slug: "philadelphia", state: "Pennsylvania", code: "PA", pop: 1603797 },
  { name: "San Antonio", slug: "san-antonio", state: "Texas", code: "TX", pop: 1434625 },
  { name: "San Diego", slug: "san-diego", state: "California", code: "CA", pop: 1386932 },
  { name: "Dallas", slug: "dallas", state: "Texas", code: "TX", pop: 1304379 },
  { name: "San Jose", slug: "san-jose", state: "California", code: "CA", pop: 1013240 },
  { name: "Austin", slug: "austin", state: "Texas", code: "TX", pop: 961855 },
  { name: "Jacksonville", slug: "jacksonville", state: "Florida", code: "FL", pop: 949611 },
  { name: "Fort Worth", slug: "fort-worth", state: "Texas", code: "TX", pop: 918915 },
  { name: "Columbus", slug: "columbus", state: "Ohio", code: "OH", pop: 905748 },
  { name: "Charlotte", slug: "charlotte", state: "North Carolina", code: "NC", pop: 885708 },
  { name: "Indianapolis", slug: "indianapolis", state: "Indiana", code: "IN", pop: 876384 },
  { name: "San Francisco", slug: "san-francisco", state: "California", code: "CA", pop: 873965 },
  { name: "Seattle", slug: "seattle", state: "Washington", code: "WA", pop: 737255 },
  { name: "Denver", slug: "denver", state: "Colorado", code: "CO", pop: 715522 },
  { name: "Nashville", slug: "nashville", state: "Tennessee", code: "TN", pop: 689447 },
  { name: "Oklahoma City", slug: "oklahoma-city", state: "Oklahoma", code: "OK", pop: 649021 },
  { name: "El Paso", slug: "el-paso", state: "Texas", code: "TX", pop: 678815 },
  { name: "Washington DC", slug: "washington-dc", state: "Washington DC", code: "DC", pop: 692683 },
  { name: "Las Vegas", slug: "las-vegas", state: "Nevada", code: "NV", pop: 641903 },
  { name: "Louisville", slug: "louisville", state: "Kentucky", code: "KY", pop: 633045 },
  { name: "Memphis", slug: "memphis", state: "Tennessee", code: "TN", pop: 650910 },
  { name: "Portland", slug: "portland", state: "Oregon", code: "OR", pop: 652503 },
  { name: "Atlanta", slug: "atlanta", state: "Georgia", code: "GA", pop: 498715 },
  { name: "Miami", slug: "miami", state: "Florida", code: "FL", pop: 467963 },
  { name: "Minneapolis", slug: "minneapolis", state: "Minnesota", code: "MN", pop: 429606 },
];

const MERCHANT_SERVICES = [
  {
    name: "Credit Card Processing",
    slug: "credit-card-processing",
    description: "Accept all major credit and debit cards with competitive rates and fast deposits.",
    keywords: ["credit card processing", "merchant services", "accept credit cards", "card payment processing", "payment processing for small business"],
  },
  {
    name: "POS System Setup",
    slug: "pos-system-setup",
    description: "Point-of-sale system installation and configuration for retail and restaurant businesses.",
    keywords: ["POS system", "point of sale system", "retail POS", "restaurant POS", "POS system setup"],
  },
  {
    name: "Payment Gateway Integration",
    slug: "payment-gateway",
    description: "Seamlessly integrate online payment gateways for e-commerce and recurring billing.",
    keywords: ["payment gateway", "online payment processing", "ecommerce payment", "payment integration", "online merchant account"],
  },
  {
    name: "Mobile Payment Solutions",
    slug: "mobile-payments",
    description: "Accept payments anywhere with mobile card readers and contactless payment technology.",
    keywords: ["mobile payment", "mobile card reader", "tap to pay", "mobile POS", "accept payments on phone"],
  },
  {
    name: "Business Cash Advance",
    slug: "business-cash-advance",
    description: "Fast business funding based on your card sales volume with flexible repayment.",
    keywords: ["merchant cash advance", "business cash advance", "business funding", "small business loan alternative", "working capital"],
  },
  {
    name: "High-Risk Merchant Accounts",
    slug: "high-risk-merchant-account",
    description: "Specialized merchant accounts for high-risk industries with reliable payment processing.",
    keywords: ["high risk merchant account", "high risk payment processing", "high risk credit card processing", "offshore merchant account"],
  },
];

async function seedSpotOn() {
  console.log("Setting up SpotOn Results account...");

  // Check if already exists
  const existing = await storage.getAccountBySlug("spoton-results");
  if (existing) {
    console.log("SpotOn Results already exists, skipping.");
    return;
  }

  // ── Account ─────────────────────────────────────────────────────
  const account = await storage.createAccount({
    name: "SpotOn Results",
    slug: "spoton-results",
    plan: "enterprise",
    status: "active",
  });
  console.log("Created account:", account.name);

  // ── Brand Profile ────────────────────────────────────────────────
  const brand = await storage.createBrandProfile({
    accountId: account.id,
    name: "SpotOn Results",
    tagline: "Merchant Services That Deliver Real Results",
    description: "SpotOn Results provides cutting-edge merchant services and payment processing solutions to businesses nationwide. We help small and medium businesses accept payments, grow sales, and manage their finances smarter.",
    phone: "(800) 555-0300",
    email: "info@spotonresults.com",
    address: "spotonresults.com",
    primaryColor: "#2563eb",
    secondaryColor: "#f59e0b",
    voiceAndTone: "Professional, trustworthy, results-driven. Use clear, direct language. Emphasize savings, speed, and reliability. Speak to business owners who are busy and want solutions, not jargon.",
  });

  // ── Website ──────────────────────────────────────────────────────
  const website = await storage.createWebsite({
    accountId: account.id,
    brandProfileId: brand.id,
    name: "SpotOn Results Main",
    domain: "spotonresults.com",
    status: "live",
    primaryIndustry: "merchant-services",
    r2Prefix: "spoton-results",
    settings: { enableFaq: true, generateSchema: true },
  });

  // ── Industry ─────────────────────────────────────────────────────
  const industry = await storage.createIndustry({
    accountId: account.id,
    name: "Merchant Services",
    slug: "merchant-services",
    description: "Payment processing, POS systems, and merchant account services for businesses",
    naicsCode: "522320",
  });

  // ── Services ─────────────────────────────────────────────────────
  const createdServices: any[] = [];
  for (const svc of MERCHANT_SERVICES) {
    const s = await storage.createService({ ...svc, accountId: account.id, industryId: industry.id });
    createdServices.push(s);
  }
  console.log(`Created ${createdServices.length} services`);

  // ── State Locations ──────────────────────────────────────────────
  const createdStates: any[] = [];
  for (const state of US_STATES) {
    const loc = await storage.createLocation({
      accountId: account.id,
      name: state.name,
      slug: state.name.toLowerCase().replace(/\s+/g, "-"),
      type: "state",
      stateCode: state.code,
      stateName: state.name,
    });
    createdStates.push(loc);
  }
  console.log(`Created ${createdStates.length} state locations`);

  // ── City Locations ───────────────────────────────────────────────
  const createdCities: any[] = [];
  for (const city of TOP_CITIES) {
    const loc = await storage.createLocation({
      accountId: account.id,
      name: city.name,
      slug: city.slug,
      type: "city",
      stateCode: city.code,
      stateName: city.state,
      population: city.pop,
    });
    createdCities.push(loc);
  }
  console.log(`Created ${createdCities.length} city locations`);

  // ── Query Clusters ───────────────────────────────────────────────
  await storage.createQueryCluster({
    accountId: account.id,
    serviceId: createdServices[0].id,
    name: "Credit Card Processing Local Intent",
    intentType: "local",
    primaryKeyword: "credit card processing near me",
    secondaryKeywords: ["merchant services near me", "accept credit cards small business", "best credit card processor"],
    searchVolume: 12100,
    difficulty: 52,
  });

  await storage.createQueryCluster({
    accountId: account.id,
    serviceId: createdServices[4].id,
    name: "Business Cash Advance Transactional",
    intentType: "transactional",
    primaryKeyword: "merchant cash advance",
    secondaryKeywords: ["business cash advance", "fast business funding", "merchant advance"],
    searchVolume: 9900,
    difficulty: 48,
  });

  // ── Blueprints ───────────────────────────────────────────────────
  const serviceCityBp = await storage.createBlueprint({
    accountId: account.id,
    websiteId: website.id,
    name: "Service + City Page",
    pageType: "service_city",
    titleTemplate: "{service} in {location}, {state} | SpotOn Results",
    metaDescTemplate: "Looking for {service} in {location}? SpotOn Results provides fast, reliable {service} to businesses in {location}, {state}. Get a free quote today!",
    h1Template: "{service} in {location}, {state}",
    slugTemplate: "{service}-{location}",
    requiredWordCount: 750,
    minPublishScore: "0.65",
    minLocalSignal: "0.55",
    maxSimilarityThreshold: "0.85",
    promptFamily: "local_service",
    faqEnabled: true,
    schemaTypes: ["LocalBusiness", "FAQPage"],
    sections: [
      { name: "Introduction", description: "Overview of the merchant service offering for businesses in this specific city" },
      { name: "Why {location} Businesses Choose SpotOn Results", description: "Local trust signals, specific business types in the city, why they need this service" },
      { name: "Our {service} Features", description: "Detailed breakdown of what's included — rates, setup, support" },
      { name: "How It Works", description: "Simple 3-step process: apply, get approved, start accepting payments" },
      { name: "Industries We Serve in {location}", description: "Retail, restaurants, service businesses, healthcare, etc. in the city" },
      { name: "FAQ", description: "4-6 questions about the service specific to local businesses" },
      { name: "Get Started Today", description: "Strong CTA with contact info and free quote offer" },
    ],
    isActive: true,
  });

  const stateHubBp = await storage.createBlueprint({
    accountId: account.id,
    websiteId: website.id,
    name: "State Hub Page",
    pageType: "state_hub",
    titleTemplate: "Merchant Services in {state} | SpotOn Results",
    metaDescTemplate: "SpotOn Results provides merchant services and payment processing to businesses across {state}. Competitive rates, fast approval, 24/7 support. Get a free quote!",
    h1Template: "Merchant Services for {state} Businesses",
    slugTemplate: "merchant-services-{state}",
    requiredWordCount: 900,
    minPublishScore: "0.68",
    minLocalSignal: "0.58",
    maxSimilarityThreshold: "0.80",
    promptFamily: "state_hub",
    faqEnabled: true,
    schemaTypes: ["Organization", "FAQPage"],
    sections: [
      { name: "Introduction", description: "Overview of merchant services for businesses across the state" },
      { name: "Payment Processing in {state}", description: "State-specific business landscape, major industries, why local businesses need good payment processing" },
      { name: "Cities We Serve in {state}", description: "Major cities and business hubs in the state" },
      { name: "Our Services in {state}", description: "Full range of services available statewide" },
      { name: "Why SpotOn Results for {state} Businesses", description: "Local expertise, nationwide backing, state-specific compliance knowledge" },
      { name: "FAQ", description: "State-specific questions about merchant services" },
    ],
    isActive: true,
  });

  console.log("Created 2 blueprints");
  console.log("\n✅ SpotOn Results setup complete!");
  console.log(`Account ID: ${account.id}`);
  console.log(`Website ID: ${website.id}`);
  console.log(`Services: ${createdServices.length}`);
  console.log(`Locations: ${createdStates.length} states + ${createdCities.length} cities = ${createdStates.length + createdCities.length} total`);
  console.log(`Blueprints: 2 (Service+City, State Hub)`);
}

seedSpotOn().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
