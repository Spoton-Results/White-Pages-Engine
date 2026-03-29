import { hashPassword } from "./auth";
import * as storage from "./storage";

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

async function seedSpotOnData(accountId: string) {
  const existingServices = await storage.getServices(accountId);
  const existingLocations = await storage.getLocations(accountId);

  if (existingServices.length === 0) {
    console.log("Seeding SpotOn services...");
    // Ensure industry exists
    let industry = (await storage.getIndustries(accountId))[0];
    if (!industry) {
      industry = await storage.createIndustry({
        accountId,
        name: "Merchant Services",
        slug: "merchant-services",
        description: "Payment processing, POS systems, and merchant account services",
        naicsCode: "522320",
      });
    }
    for (const svc of MERCHANT_SERVICES) {
      await storage.createService({ ...svc, accountId, industryId: industry.id });
    }
    console.log(`Seeded ${MERCHANT_SERVICES.length} services`);
  }

  if (existingLocations.length === 0) {
    console.log("Seeding SpotOn locations...");
    for (const state of US_STATES) {
      await storage.createLocation({
        accountId,
        name: state.name,
        slug: state.name.toLowerCase().replace(/\s+/g, "-"),
        type: "state",
        stateCode: state.code,
        stateName: state.name,
      });
    }
    for (const city of TOP_CITIES) {
      await storage.createLocation({
        accountId,
        name: city.name,
        slug: city.slug,
        type: "city",
        stateCode: city.code,
        stateName: city.state,
        population: city.pop,
      });
    }
    console.log(`Seeded ${US_STATES.length} states + ${TOP_CITIES.length} cities`);
  }
}

export async function seedDatabase() {
  console.log("Seeding database...");

  // ── Super Admin ─────────────────────────────────────────────────────────────
  const existing = await storage.getUserByEmail("admin@nexus.io");
  if (!existing) {
    const superAdmin = await storage.createUser({
      accountId: null,
      username: "admin",
      email: "admin@nexus.io",
      password: await hashPassword("admin123"),
      role: "super_admin",
      isSuperAdmin: true,
    });
    console.log("Created super admin:", superAdmin.email);
  }

  // ── SpotOn Results — self-heal missing services/locations ───────────────────
  // Find by name to handle both dev and production accounts regardless of slug
  const accounts = await storage.getAccounts();
  const spoton = accounts.find((a: any) =>
    a.name.toLowerCase().includes("spoton") || a.name.toLowerCase().includes("spot on")
  );
  if (spoton) {
    await seedSpotOnData(spoton.id);
  }

  console.log("Seed check complete.");
}
