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

  await seedStateData();

  console.log("Seed check complete.");
}

// ─── State Data ───────────────────────────────────────────────────────────────

async function seedStateData() {
  const existing = await storage.getStateDataCount();
  if (existing >= 50) return;

  const states = [
    { stateName: "Alabama", stateAbbr: "AL", population: 5073000, businessCount: 395000, majorCities: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"], landmarks: ["Vulcan Statue", "USS Alabama Battleship Memorial Park", "Little River Canyon National Preserve"], businessCulture: "Blue-collar manufacturing economy with strong loyalty to local businesses and community banks.", paymentRegulations: "No state-level payment surcharge restrictions; standard PCI DSS compliance required." },
    { stateName: "Alaska", stateAbbr: "AK", population: 733583, businessCount: 65000, majorCities: ["Anchorage", "Fairbanks", "Juneau", "Sitka", "Wasilla"], landmarks: ["Denali National Park", "Mendenhall Glacier", "Tongass National Forest"], businessCulture: "Resource-dependent economy with high demand for mobile and contactless payment solutions in remote areas.", paymentRegulations: "No state sales tax; local municipalities may impose borough-level transaction fees." },
    { stateName: "Arizona", stateAbbr: "AZ", population: 7359197, businessCount: 580000, majorCities: ["Phoenix", "Tucson", "Scottsdale", "Mesa", "Tempe"], landmarks: ["Grand Canyon", "Monument Valley", "Sedona Red Rocks"], businessCulture: "Sun Belt growth economy with thriving retail, hospitality, and real estate sectors.", paymentRegulations: "Surcharging permitted; must disclose at point of sale under standard federal guidelines." },
    { stateName: "Arkansas", stateAbbr: "AR", population: 3045637, businessCount: 235000, majorCities: ["Little Rock", "Fayetteville", "Fort Smith", "Jonesboro", "Springdale"], landmarks: ["Crater of Diamonds State Park", "Hot Springs National Park", "Buffalo National River"], businessCulture: "Agricultural and retail-driven economy with growing tech and logistics sectors in Northwest Arkansas.", paymentRegulations: "No specific payment surcharge laws; standard federal regulations apply." },
    { stateName: "California", stateAbbr: "CA", population: 38940231, businessCount: 4200000, majorCities: ["Los Angeles", "San Francisco", "San Diego", "Sacramento", "San Jose"], landmarks: ["Golden Gate Bridge", "Yosemite National Park", "Hollywood Sign"], businessCulture: "Innovation-driven economy with high consumer expectations for seamless digital payment experiences.", paymentRegulations: "Surcharging now permitted following court rulings; disclosure requirements strictly enforced." },
    { stateName: "Colorado", stateAbbr: "CO", population: 5877610, businessCount: 625000, majorCities: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"], landmarks: ["Rocky Mountain National Park", "Garden of the Gods", "Red Rocks Amphitheatre"], businessCulture: "Outdoor recreation and tech-forward economy with strong preference for modern payment systems.", paymentRegulations: "Surcharging permitted with proper disclosure; competitive merchant services market." },
    { stateName: "Connecticut", stateAbbr: "CT", population: 3626205, businessCount: 350000, majorCities: ["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury"], landmarks: ["Mark Twain House", "Mystic Seaport", "Yale University"], businessCulture: "Financial services and insurance hub with sophisticated business payment infrastructure.", paymentRegulations: "Surcharging permitted; cash discounting widely practiced among small retailers." },
    { stateName: "Delaware", stateAbbr: "DE", population: 1018396, businessCount: 105000, majorCities: ["Wilmington", "Dover", "Newark", "Middletown", "Smyrna"], landmarks: ["Cape Henlopen State Park", "Hagley Museum", "Rehoboth Beach"], businessCulture: "Corporate-friendly environment with many businesses incorporated here for favorable regulations.", paymentRegulations: "No state sales tax; corporate payment processing often more favorable due to business-friendly laws." },
    { stateName: "Florida", stateAbbr: "FL", population: 22610726, businessCount: 2800000, majorCities: ["Miami", "Orlando", "Tampa", "Jacksonville", "Fort Lauderdale"], landmarks: ["Everglades National Park", "Walt Disney World", "Kennedy Space Center"], businessCulture: "Tourism-driven economy with year-round demand for fast, reliable point-of-sale solutions.", paymentRegulations: "Surcharging permitted since 2017 court ruling; disclosure at point of sale required." },
    { stateName: "Georgia", stateAbbr: "GA", population: 11029227, businessCount: 1100000, majorCities: ["Atlanta", "Augusta", "Columbus", "Savannah", "Macon"], landmarks: ["Stone Mountain", "Okefenokee Swamp", "Martin Luther King Jr. National Historic Site"], businessCulture: "Business-friendly Southern hub and home of major Fortune 500 headquarters including Coca-Cola and Home Depot.", paymentRegulations: "No specific surcharge law; standard federal rules apply." },
    { stateName: "Hawaii", stateAbbr: "HI", population: 1440196, businessCount: 135000, majorCities: ["Honolulu", "Hilo", "Kailua", "Kapolei", "Pearl City"], landmarks: ["Waikiki Beach", "Hawaii Volcanoes National Park", "Pearl Harbor"], businessCulture: "Tourism and hospitality-dependent economy with strong demand for multi-currency payment solutions.", paymentRegulations: "General excise tax applies to merchant services; unique tax structure for payment processors." },
    { stateName: "Idaho", stateAbbr: "ID", population: 1920562, businessCount: 170000, majorCities: ["Boise", "Nampa", "Meridian", "Idaho Falls", "Pocatello"], landmarks: ["Craters of the Moon National Monument", "Sun Valley", "Shoshone Falls"], businessCulture: "Agriculture and tech growth economy with an emerging startup ecosystem in the Boise metro area.", paymentRegulations: "No state surcharge restrictions; standard PCI compliance required." },
    { stateName: "Illinois", stateAbbr: "IL", population: 12582032, businessCount: 1250000, majorCities: ["Chicago", "Aurora", "Joliet", "Naperville", "Rockford"], landmarks: ["Willis Tower", "Navy Pier", "Millennium Park"], businessCulture: "Diverse manufacturing, finance, and services economy with the highest merchant services demand in the Midwest.", paymentRegulations: "Surcharging permitted; Chicago imposes additional transaction taxes for certain hospitality businesses." },
    { stateName: "Indiana", stateAbbr: "IN", population: 6833037, businessCount: 580000, majorCities: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel"], landmarks: ["Indiana Dunes National Park", "Indianapolis Motor Speedway", "Conner Prairie"], businessCulture: "Manufacturing and logistics powerhouse with a strong automotive sector and growing tech community.", paymentRegulations: "No state surcharge restrictions beyond federal law." },
    { stateName: "Iowa", stateAbbr: "IA", population: 3200517, businessCount: 290000, majorCities: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City"], landmarks: ["Effigy Mounds National Monument", "Bridges of Madison County", "Iowa State Capitol"], businessCulture: "Agriculture-first economy with growing financial technology adoption among rural and urban businesses.", paymentRegulations: "Standard regulations; agriculture-specific payment programs available from regional processors." },
    { stateName: "Kansas", stateAbbr: "KS", population: 2940865, businessCount: 270000, majorCities: ["Wichita", "Overland Park", "Kansas City", "Topeka", "Olathe"], landmarks: ["Tallgrass Prairie National Preserve", "Eisenhower Presidential Library", "Monument Rocks"], businessCulture: "Agriculture and aviation economy with a practical, no-frills approach to business payment systems.", paymentRegulations: "No specific surcharge legislation; standard federal payment processing rules apply." },
    { stateName: "Kentucky", stateAbbr: "KY", population: 4526154, businessCount: 395000, majorCities: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington"], landmarks: ["Mammoth Cave National Park", "Churchill Downs", "Red River Gorge"], businessCulture: "Equine industry, manufacturing, and bourbon economy with a strong tradition of cash payments shifting to digital.", paymentRegulations: "No state surcharge restrictions; standard federal regulations." },
    { stateName: "Louisiana", stateAbbr: "LA", population: 4590241, businessCount: 430000, majorCities: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles"], landmarks: ["French Quarter", "Oak Alley Plantation", "Bayou Country"], businessCulture: "Tourism, energy, and hospitality economy with high card-present transaction volumes in entertainment districts.", paymentRegulations: "No specific surcharge laws; standard federal regulations apply." },
    { stateName: "Maine", stateAbbr: "ME", population: 1385340, businessCount: 145000, majorCities: ["Portland", "Augusta", "Bangor", "South Portland", "Biddeford"], landmarks: ["Acadia National Park", "Portland Head Light", "Baxter State Park"], businessCulture: "Tourism, lobster industry, and artisan economy with strong preference for locally owned businesses.", paymentRegulations: "No state-level surcharge restrictions; standard PCI DSS compliance." },
    { stateName: "Maryland", stateAbbr: "MD", population: 6164660, businessCount: 620000, majorCities: ["Baltimore", "Frederick", "Rockville", "Gaithersburg", "Bowie"], landmarks: ["Inner Harbor", "National Aquarium", "Assateague Island"], businessCulture: "Government, biotech, and defense economy with high concentration of federal contractor payment needs.", paymentRegulations: "Surcharging permitted with disclosure; strong consumer protection laws apply." },
    { stateName: "Massachusetts", stateAbbr: "MA", population: 7029917, businessCount: 720000, majorCities: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell"], landmarks: ["Freedom Trail", "Fenway Park", "Plymouth Rock"], businessCulture: "Innovation and education economy with early adoption of contactless and digital payment technologies.", paymentRegulations: "Surcharging was historically restricted; now permitted with proper disclosure requirements." },
    { stateName: "Michigan", stateAbbr: "MI", population: 10034113, businessCount: 870000, majorCities: ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor"], landmarks: ["Pictured Rocks National Lakeshore", "Sleeping Bear Dunes", "Henry Ford Museum"], businessCulture: "Auto industry and manufacturing economy with large workforce accustomed to corporate payment systems.", paymentRegulations: "No specific surcharge restrictions beyond federal law." },
    { stateName: "Minnesota", stateAbbr: "MN", population: 5706494, businessCount: 580000, majorCities: ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington"], landmarks: ["Mall of America", "Boundary Waters Canoe Area", "SPAM Museum"], businessCulture: "Fortune 500 hub with progressive business culture and early adoption of EMV and contactless payments.", paymentRegulations: "No state surcharge law; PCI compliance heavily enforced by processors operating here." },
    { stateName: "Mississippi", stateAbbr: "MS", population: 2940057, businessCount: 220000, majorCities: ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"], landmarks: ["Natchez Trace Parkway", "Gulf Islands National Seashore", "Vicksburg National Military Park"], businessCulture: "Agriculture and gaming economy with growing demand for modern payment solutions among small businesses.", paymentRegulations: "No state surcharge restrictions." },
    { stateName: "Missouri", stateAbbr: "MO", population: 6177957, businessCount: 585000, majorCities: ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence"], landmarks: ["Gateway Arch", "Silver Dollar City", "Mark Twain Birthplace"], businessCulture: "Agriculture, aerospace, and financial services economy with high card acceptance rates in urban corridors.", paymentRegulations: "No specific surcharge legislation; standard federal rules." },
    { stateName: "Montana", stateAbbr: "MT", population: 1122867, businessCount: 110000, majorCities: ["Billings", "Missoula", "Great Falls", "Bozeman", "Butte"], landmarks: ["Glacier National Park", "Beartooth Highway", "Little Bighorn Battlefield"], businessCulture: "Agriculture, ranching, and tourism economy with practical payment needs and growing mobile adoption.", paymentRegulations: "No state surcharge restrictions; standard federal regulations apply." },
    { stateName: "Nebraska", stateAbbr: "NE", population: 1961504, businessCount: 195000, majorCities: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney"], landmarks: ["Chimney Rock National Historic Site", "Scotts Bluff National Monument", "Henry Doorly Zoo"], businessCulture: "Agriculture and insurance economy with conservative business practices shifting toward modern payment technology.", paymentRegulations: "No specific surcharge legislation; standard federal payment processing rules." },
    { stateName: "Nevada", stateAbbr: "NV", population: 3143991, businessCount: 310000, majorCities: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks"], landmarks: ["Las Vegas Strip", "Hoover Dam", "Red Rock Canyon"], businessCulture: "Gaming, hospitality, and entertainment economy with the highest per-capita card transaction volume in the nation.", paymentRegulations: "Surcharging permitted; strong merchant services competition keeps processing rates competitive." },
    { stateName: "New Hampshire", stateAbbr: "NH", population: 1395231, businessCount: 145000, majorCities: ["Manchester", "Nashua", "Concord", "Derry", "Dover"], landmarks: ["White Mountains", "Lake Winnipesaukee", "Flume Gorge"], businessCulture: "Tax-free retail economy attracting cross-border shoppers with high debit and cash transaction volumes.", paymentRegulations: "No state sales tax creates a unique payment processing environment; no surcharge restrictions." },
    { stateName: "New Jersey", stateAbbr: "NJ", population: 9261699, businessCount: 1000000, majorCities: ["Newark", "Jersey City", "Paterson", "Elizabeth", "Trenton"], landmarks: ["Liberty State Park", "Cape May", "Princeton University"], businessCulture: "Dense suburban economy with high concentration of retail, pharma, and finance payment processing needs.", paymentRegulations: "Surcharging permitted with disclosure requirements; strong consumer protection laws." },
    { stateName: "New Mexico", stateAbbr: "NM", population: 2113344, businessCount: 180000, majorCities: ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe", "Roswell"], landmarks: ["Carlsbad Caverns National Park", "White Sands National Park", "Meow Wolf Santa Fe"], businessCulture: "Tourism, energy, and arts economy with unique small business payment needs driven by the creative sector.", paymentRegulations: "No specific surcharge legislation; standard federal regulations." },
    { stateName: "New York", stateAbbr: "NY", population: 19677151, businessCount: 2200000, majorCities: ["New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse"], landmarks: ["Statue of Liberty", "Niagara Falls", "Times Square"], businessCulture: "Global financial capital with the highest merchant services usage and most competitive payment processing rates.", paymentRegulations: "Surcharging now permitted following federal ruling; clear disclosure required at point of sale." },
    { stateName: "North Carolina", stateAbbr: "NC", population: 10698973, businessCount: 1050000, majorCities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem"], landmarks: ["Great Smoky Mountains", "Cape Hatteras National Seashore", "Biltmore Estate"], businessCulture: "Tech Research Triangle and finance economy with high business formation rate and modern payment adoption.", paymentRegulations: "No specific surcharge restrictions; standard federal guidelines apply." },
    { stateName: "North Dakota", stateAbbr: "ND", population: 779094, businessCount: 75000, majorCities: ["Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo"], landmarks: ["Theodore Roosevelt National Park", "International Peace Garden", "Enchanted Highway"], businessCulture: "Agriculture and energy boom economy with practical approach to business payment systems.", paymentRegulations: "No state surcharge restrictions." },
    { stateName: "Ohio", stateAbbr: "OH", population: 11756058, businessCount: 1100000, majorCities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron"], landmarks: ["Rock and Roll Hall of Fame", "Cedar Point", "Cuyahoga Valley National Park"], businessCulture: "Diverse manufacturing, retail, and financial services economy with broad merchant services adoption.", paymentRegulations: "No specific surcharge legislation; standard federal rules apply." },
    { stateName: "Oklahoma", stateAbbr: "OK", population: 4053824, businessCount: 380000, majorCities: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond"], landmarks: ["Route 66", "Wichita Mountains Wildlife Refuge", "Chickasaw National Recreation Area"], businessCulture: "Energy and agriculture economy with entrepreneurial small business culture adopting modern payment systems.", paymentRegulations: "No state surcharge restrictions." },
    { stateName: "Oregon", stateAbbr: "OR", population: 4240137, businessCount: 415000, majorCities: ["Portland", "Eugene", "Salem", "Gresham", "Hillsboro"], landmarks: ["Crater Lake National Park", "Cannon Beach", "Columbia River Gorge"], businessCulture: "Progressive outdoor and tech economy with high contactless payment adoption and strong local merchant support.", paymentRegulations: "Surcharging permitted with disclosure; no state sales tax simplifies transaction calculations." },
    { stateName: "Pennsylvania", stateAbbr: "PA", population: 12972008, businessCount: 1150000, majorCities: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading"], landmarks: ["Liberty Bell", "Gettysburg National Military Park", "Philadelphia Museum of Art"], businessCulture: "Manufacturing, healthcare, and finance economy with diverse payment needs across urban and rural markets.", paymentRegulations: "No specific surcharge legislation beyond federal law." },
    { stateName: "Rhode Island", stateAbbr: "RI", population: 1093734, businessCount: 110000, majorCities: ["Providence", "Cranston", "Warwick", "Pawtucket", "East Providence"], landmarks: ["The Breakers", "WaterFire Providence", "Newport Cliff Walk"], businessCulture: "Manufacturing and tourism economy with small but dense business environment requiring efficient payment solutions.", paymentRegulations: "No state surcharge restrictions." },
    { stateName: "South Carolina", stateAbbr: "SC", population: 5282634, businessCount: 490000, majorCities: ["Columbia", "Charleston", "North Charleston", "Mount Pleasant", "Rock Hill"], landmarks: ["Myrtle Beach", "Fort Sumter", "Congaree National Park"], businessCulture: "Tourism, manufacturing, and growing tech economy with strong hospitality sector payment processing demand.", paymentRegulations: "No specific surcharge legislation; standard federal rules." },
    { stateName: "South Dakota", stateAbbr: "SD", population: 909824, businessCount: 90000, majorCities: ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown"], landmarks: ["Mount Rushmore", "Badlands National Park", "Crazy Horse Memorial"], businessCulture: "Agriculture, finance, and tourism economy; South Dakota is a major credit card issuer hub due to no usury laws.", paymentRegulations: "No state income or corporate tax; highly favorable environment for financial services companies." },
    { stateName: "Tennessee", stateAbbr: "TN", population: 7051339, businessCount: 660000, majorCities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"], landmarks: ["Grand Ole Opry", "Great Smoky Mountains National Park", "Dollywood"], businessCulture: "Music, tourism, and automotive economy with high hospitality sector payment processing volumes.", paymentRegulations: "No specific surcharge restrictions; standard federal regulations apply." },
    { stateName: "Texas", stateAbbr: "TX", population: 30029572, businessCount: 3100000, majorCities: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth"], landmarks: ["The Alamo", "Big Bend National Park", "Space Center Houston"], businessCulture: "Largest small business economy in the nation with diverse payment needs across energy, tech, and retail sectors.", paymentRegulations: "No state surcharge restrictions; competitive market drives down processing rates significantly." },
    { stateName: "Utah", stateAbbr: "UT", population: 3380800, businessCount: 330000, majorCities: ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem"], landmarks: ["Zion National Park", "Arches National Park", "Temple Square"], businessCulture: "Rapidly growing tech (Silicon Slopes) and outdoor recreation economy with high mobile payment adoption.", paymentRegulations: "No state surcharge restrictions; standard PCI compliance." },
    { stateName: "Vermont", stateAbbr: "VT", population: 647464, businessCount: 65000, majorCities: ["Burlington", "South Burlington", "Rutland", "Barre", "Montpelier"], landmarks: ["Ben & Jerry's Factory", "Green Mountain National Forest", "Stowe Mountain Resort"], businessCulture: "Farm-to-table and artisan economy with strong preference for local business and transparent payment practices.", paymentRegulations: "No state surcharge restrictions; straightforward regulatory environment." },
    { stateName: "Virginia", stateAbbr: "VA", population: 8683619, businessCount: 850000, majorCities: ["Virginia Beach", "Norfolk", "Chesapeake", "Arlington", "Richmond"], landmarks: ["Monticello", "Colonial Williamsburg", "Shenandoah National Park"], businessCulture: "Government contracting, tech (Northern Virginia data center corridor), and military economy.", paymentRegulations: "No specific surcharge legislation; standard federal payment processing rules." },
    { stateName: "Washington", stateAbbr: "WA", population: 7785786, businessCount: 790000, majorCities: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue"], landmarks: ["Pike Place Market", "Mount Rainier National Park", "Space Needle"], businessCulture: "Tech giant economy (Amazon, Microsoft) with the highest mobile and contactless payment adoption rates.", paymentRegulations: "Surcharging permitted with disclosure; high consumer awareness of payment fee regulations." },
    { stateName: "West Virginia", stateAbbr: "WV", population: 1775156, businessCount: 135000, majorCities: ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling"], landmarks: ["Harpers Ferry National Historical Park", "Blackwater Falls State Park", "New River Gorge National Park"], businessCulture: "Energy and manufacturing economy transitioning to tourism and services with growing payment technology adoption.", paymentRegulations: "No state surcharge restrictions." },
    { stateName: "Wisconsin", stateAbbr: "WI", population: 5893718, businessCount: 560000, majorCities: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine"], landmarks: ["Wisconsin Dells", "Door County", "Harley-Davidson Museum"], businessCulture: "Manufacturing, dairy, and tourism economy with strong community banking relationships.", paymentRegulations: "No specific surcharge legislation; standard federal rules apply." },
    { stateName: "Wyoming", stateAbbr: "WY", population: 584057, businessCount: 60000, majorCities: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs"], landmarks: ["Yellowstone National Park", "Grand Teton National Park", "Devils Tower"], businessCulture: "Energy and ranching economy with sparse population requiring remote payment solutions and reliable connectivity.", paymentRegulations: "No state income tax; minimal business payment regulations and no surcharge restrictions." },
  ];

  for (const s of states) {
    await storage.insertStateData(s);
  }
  console.log(`Seeded ${states.length} US states into state_data.`);
}
