// Cascada — Database Seed
// Creates the initial platform tenant and admin user.
// Run with: npm run db:seed

import { PrismaClient, Plan, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ============================================================================
  // Create platform tenant (for the Cascada team itself)
  // ============================================================================
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: "cascada-platform" },
    update: {},
    create: {
      name: "Cascada Platform",
      slug: "cascada-platform",
      plan: Plan.COMMAND,
    },
  });

  console.log(`✅ Created platform tenant: ${platformTenant.id}`);

  // ============================================================================
  // Create demo tenant (for testing and demos)
  // ============================================================================
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: "demo-foods" },
    update: {},
    create: {
      name: "Demo Foods Inc.",
      slug: "demo-foods",
      plan: Plan.PRO,
    },
  });

  console.log(`✅ Created demo tenant: ${demoTenant.id}`);

  // ============================================================================
  // Create admin users
  // ============================================================================
  const platformAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: platformTenant.id,
        email: "admin@cascada.io",
      },
    },
    update: {},
    create: {
      email: "admin@cascada.io",
      name: "Platform Admin",
      role: UserRole.SUPER_ADMIN,
      tenantId: platformTenant.id,
    },
  });

  console.log(`✅ Created platform admin: ${platformAdmin.id}`);

  const demoAdmin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: demoTenant.id,
        email: "admin@demofoods.com",
      },
    },
    update: {},
    create: {
      email: "admin@demofoods.com",
      name: "Demo Admin",
      role: UserRole.TENANT_ADMIN,
      tenantId: demoTenant.id,
    },
  });

  console.log(`✅ Created demo admin: ${demoAdmin.id}`);

  // ============================================================================
  // Create demo data for the demo tenant
  // This provides a realistic starting point for development
  // ============================================================================

  // Sample ingredients
  const red40 = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "Red 40 (Allura Red AC)",
      alternateNames: ["FD&C Red No. 40", "Allura Red", "E129"],
      casNumber: "25956-17-6",
      eenumber: "E129",
      category: "dye",
      isSynthetic: true,
      sourceType: "petroleum",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const yellow5 = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "Yellow 5 (Tartrazine)",
      alternateNames: ["FD&C Yellow No. 5", "Tartrazine", "E102"],
      casNumber: "1934-21-0",
      eenumber: "E102",
      category: "dye",
      isSynthetic: true,
      sourceType: "petroleum",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const yellow6 = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "Yellow 6 (Sunset Yellow FCF)",
      alternateNames: ["FD&C Yellow No. 6", "Sunset Yellow", "E110"],
      casNumber: "2783-94-0",
      eenumber: "E110",
      category: "dye",
      isSynthetic: true,
      sourceType: "petroleum",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const blue1 = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "Blue 1 (Brilliant Blue FCF)",
      alternateNames: ["FD&C Blue No. 1", "Brilliant Blue", "E133"],
      casNumber: "3844-45-9",
      eenumber: "E133",
      category: "dye",
      isSynthetic: true,
      sourceType: "petroleum",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const tbhq = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "TBHQ (tert-Butylhydroquinone)",
      alternateNames: ["TBHQ", "tert-Butylhydroquinone", "E319"],
      casNumber: "1948-33-0",
      eenumber: "E319",
      category: "preservative",
      isSynthetic: true,
      sourceType: "synthetic",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const bha = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "BHA (Butylated hydroxyanisole)",
      alternateNames: ["BHA", "Butylated hydroxyanisole", "E320"],
      casNumber: "25013-16-5",
      eenumber: "E320",
      category: "preservative",
      isSynthetic: true,
      sourceType: "synthetic",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const bht = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "BHT (Butylated hydroxytoluene)",
      alternateNames: ["BHT", "Butylated hydroxytoluene", "E321"],
      casNumber: "128-37-0",
      eenumber: "E321",
      category: "preservative",
      isSynthetic: true,
      sourceType: "synthetic",
      allergenFlags: [],
      supplierIds: [],
    },
  });

  const potassiumBromate = await prisma.ingredient.create({
    data: {
      tenantId: demoTenant.id,
      name: "Potassium Bromate",
      alternateNames: ["E924", "Bromated flour"],
      casNumber: "7758-01-2",
      eenumber: "E924",
      category: "other",
      isSynthetic: true,
      sourceType: "mineral",
      allergenFlags: ["gluten"],
      supplierIds: [],
    },
  });

  console.log(`✅ Created ${8} sample ingredients`);

  // Sample formulation
  const sportsDrinkFormulation = await prisma.formulation.create({
    data: {
      tenantId: demoTenant.id,
      name: "Sports Drink - Orange (Base Formula)",
      description: "Base formulation for orange sports drink product line",
      version: 1,
      status: "ACTIVE",
      batchSize: 1000,
      batchSizeUnit: "L",
      items: {
        create: [
          { ingredientId: yellow6.id, quantity: 0.05, unit: "kg", percentage: 0.005, sortOrder: 1 },
          { ingredientId: yellow5.id, quantity: 0.02, unit: "kg", percentage: 0.002, sortOrder: 2 },
          { ingredientId: red40.id, quantity: 0.01, unit: "kg", percentage: 0.001, sortOrder: 3 },
          { ingredientId: tbhq.id, quantity: 0.02, unit: "kg", percentage: 0.002, sortOrder: 4 },
        ],
      },
    },
  });

  const snackFormulation = await prisma.formulation.create({
    data: {
      tenantId: demoTenant.id,
      name: "Cheese Cracker (Base Formula)",
      description: "Base formulation for cheese cracker product line",
      version: 1,
      status: "ACTIVE",
      batchSize: 500,
      batchSizeUnit: "kg",
      items: {
        create: [
          { ingredientId: yellow5.id, quantity: 0.1, unit: "kg", percentage: 0.02, sortOrder: 1 },
          { ingredientId: yellow6.id, quantity: 0.08, unit: "kg", percentage: 0.016, sortOrder: 2 },
          { ingredientId: bha.id, quantity: 0.02, unit: "kg", percentage: 0.004, sortOrder: 3 },
          { ingredientId: bht.id, quantity: 0.02, unit: "kg", percentage: 0.004, sortOrder: 4 },
        ],
      },
    },
  });

  const breadFormulation = await prisma.formulation.create({
    data: {
      tenantId: demoTenant.id,
      name: "White Bread (Base Formula)",
      description: "Base formulation for white bread product line",
      version: 1,
      status: "ACTIVE",
      batchSize: 200,
      batchSizeUnit: "kg",
      items: {
        create: [
          { ingredientId: potassiumBromate.id, quantity: 0.03, unit: "kg", percentage: 0.015, sortOrder: 1 },
        ],
      },
    },
  });

  console.log(`✅ Created 3 sample formulations`);

  // Sample products
  const sportsDrink = await prisma.product.create({
    data: {
      tenantId: demoTenant.id,
      name: "Thunder Bolt Orange Sports Drink",
      sku: "TBSD-ORG-001",
      category: "Beverages",
      brand: "Thunder Bolt",
      markets: ["US-CA", "US-TX", "US-NY", "US-FL", "US-IL"],
      retailers: ["walmart", "target", "kroger"],
      annualVolume: 2500000,
      annualRevenue: 3750000,
      formulations: {
        create: {
          formulationId: sportsDrinkFormulation.id,
          isCurrent: true,
        },
      },
    },
  });

  const cheeseCracker = await prisma.product.create({
    data: {
      tenantId: demoTenant.id,
      name: "Cheddar Burst Crackers",
      sku: "CBCC-CHD-001",
      category: "Snacks",
      brand: "Cheddar Burst",
      markets: ["US-CA", "US-TX", "US-NY", "US-PA", "US-OH"],
      retailers: ["walmart", "target", "costco"],
      annualVolume: 5000000,
      annualRevenue: 8000000,
      formulations: {
        create: {
          formulationId: snackFormulation.id,
          isCurrent: true,
        },
      },
    },
  });

  const whiteBread = await prisma.product.create({
    data: {
      tenantId: demoTenant.id,
      name: "Soft White Bread Loaf",
      sku: "SWBL-WHT-001",
      category: "Bakery",
      brand: "Soft White",
      markets: ["US-CA", "US-TX", "US-NY"],
      retailers: ["walmart", "kroger", "safeway"],
      annualVolume: 8000000,
      annualRevenue: 12000000,
      formulations: {
        create: {
          formulationId: breadFormulation.id,
          isCurrent: true,
        },
      },
    },
  });

  console.log(`✅ Created 3 sample products`);

  // Sample customers
  const walmart = await prisma.customer.create({
    data: {
      tenantId: demoTenant.id,
      name: "Walmart",
      type: "RETAILER",
      contactEmail: "vendor@walmart.com",
      requirements: {
        cleanLabelInitiative: true,
        restrictedIngredients: ["Red 40", "Yellow 5", "Yellow 6"],
        phaseOutDate: "2025-12-31",
      },
      customerProducts: {
        create: [
          { productId: sportsDrink.id, isActive: true },
          { productId: cheeseCracker.id, isActive: true },
          { productId: whiteBread.id, isActive: true },
        ],
      },
    },
  });

  const target = await prisma.customer.create({
    data: {
      tenantId: demoTenant.id,
      name: "Target",
      type: "RETAILER",
      contactEmail: "vendors@target.com",
      requirements: {
        targetCleanProgram: true,
        restrictedIngredients: ["BHA", "BHT", "TBHQ"],
      },
      customerProducts: {
        create: [
          { productId: sportsDrink.id, isActive: true },
          { productId: cheeseCracker.id, isActive: true },
        ],
      },
    },
  });

  const kroger = await prisma.customer.create({
    data: {
      tenantId: demoTenant.id,
      name: "Kroger",
      type: "RETAILER",
      contactEmail: "suppliers@kroger.com",
      requirements: {
        simpleTruthStandard: true,
      },
      customerProducts: {
        create: [
          { productId: sportsDrink.id, isActive: true },
          { productId: whiteBread.id, isActive: true },
        ],
      },
    },
  });

  console.log(`✅ Created 3 sample customers`);

  // Sample suppliers
  const dyeSupplier = await prisma.supplier.create({
    data: {
      tenantId: demoTenant.id,
      name: "Sensient Colors LLC",
      contactEmail: "orders@sensient.com",
      certifications: ["ISO 9001", "FSSC 22000", "Kosher"],
      ingredientIds: [red40.id, yellow5.id, yellow6.id, blue1.id],
      riskScore: 0.3,
    },
  });

  const preservativeSupplier = await prisma.supplier.create({
    data: {
      tenantId: demoTenant.id,
      name: "Camlin Fine Sciences",
      contactEmail: "sales@camlin.com",
      certifications: ["ISO 9001", "FSSC 22000"],
      ingredientIds: [tbhq.id, bha.id, bht.id],
      riskScore: 0.25,
    },
  });

  console.log(`✅ Created 2 sample suppliers`);

  // ============================================================================
  // Sample regulatory source (California AB 418 - real bill)
  // ============================================================================
  const caAb418 = await prisma.regulatorySource.create({
    data: {
      sourceType: "STATE_BILL",
      jurisdiction: "US-CA",
      name: "California AB 418 — Food Safety: Prohibited Additives",
      sourceId: "CA-2025-AB418",
      sourceUrl: "https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB418",
      status: "ACTIVE",
      introducedDate: new Date("2025-02-10"),
      enactedDate: new Date("2025-10-01"),
      effectiveDate: new Date("2027-01-01"),
      fullText: "An act to add Section 110823 to the Health and Safety Code, relating to food safety. This bill would prohibit a person from manufacturing, selling, delivering, distributing, holding, or offering for sale a food product that contains certain specified substances, including Red 40, Yellow 5, Yellow 6, Blue 1, Blue 2, and Green 3, beginning January 1, 2027.",
      rules: {
        create: {
          jurisdiction: "US-CA",
          ruleType: "BAN",
          description: "Bans the sale of food products containing Red 40, Yellow 5, Yellow 6, Blue 1, Blue 2, and Green 3 artificial food dyes in California, effective January 1, 2027.",
          effectiveDate: new Date("2027-01-01"),
          complianceDate: new Date("2027-01-01"),
          gracePeriodDays: 0,
          penaltyType: "fine_per_violation",
          penaltyAmount: 5000,
          substances: {
            create: [
              { substanceName: "Red 40", substanceType: "specific_chemical", casNumber: "25956-17-6", eenumber: "E129", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: red40.id },
              { substanceName: "Yellow 5", substanceType: "specific_chemical", casNumber: "1934-21-0", eenumber: "E102", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: yellow5.id },
              { substanceName: "Yellow 6", substanceType: "specific_chemical", casNumber: "2783-94-0", eenumber: "E110", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: yellow6.id },
              { substanceName: "Blue 1", substanceType: "specific_chemical", casNumber: "3844-45-9", eenumber: "E133", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: blue1.id },
            ],
          },
        },
      },
    },
  });

  // Texas SB 25
  const txSb25 = await prisma.regulatorySource.create({
    data: {
      sourceType: "STATE_BILL",
      jurisdiction: "US-TX",
      name: "Texas SB 25 — Food Additive Safety",
      sourceId: "TX-2025-SB25",
      sourceUrl: "https://capitol.texas.gov/tlodocs/89R/billtext/html/SB00025.htm",
      status: "ACTIVE",
      introducedDate: new Date("2025-01-15"),
      enactedDate: new Date("2025-06-20"),
      effectiveDate: new Date("2026-09-01"),
      fullText: "Relating to the safety of food additives. This act prohibits the sale of food products containing certain artificial dyes and chemicals including Red 40, Yellow 5, Yellow 6, Blue 1, Blue 2, Green 3, TBHQ, BHA, BHT, and potassium bromate.",
      rules: {
        create: {
          jurisdiction: "US-TX",
          ruleType: "BAN",
          description: "Bans food products containing specified artificial dyes, preservatives, and potassium bromate in Texas, effective September 1, 2026.",
          effectiveDate: new Date("2026-09-01"),
          complianceDate: new Date("2026-09-01"),
          gracePeriodDays: 90,
          penaltyType: "fine_per_violation",
          penaltyAmount: 25000,
          substances: {
            create: [
              { substanceName: "Red 40", substanceType: "specific_chemical", casNumber: "25956-17-6", eenumber: "E129", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: red40.id },
              { substanceName: "Yellow 5", substanceType: "specific_chemical", casNumber: "1934-21-0", eenumber: "E102", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: yellow5.id },
              { substanceName: "Yellow 6", substanceType: "specific_chemical", casNumber: "2783-94-0", eenumber: "E110", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: yellow6.id },
              { substanceName: "Blue 1", substanceType: "specific_chemical", casNumber: "3844-45-9", eenumber: "E133", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: blue1.id },
              { substanceName: "TBHQ", substanceType: "specific_chemical", casNumber: "1948-33-0", eenumber: "E319", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: tbhq.id },
              { substanceName: "BHA", substanceType: "specific_chemical", casNumber: "25013-16-5", eenumber: "E320", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: bha.id },
              { substanceName: "BHT", substanceType: "specific_chemical", casNumber: "128-37-0", eenumber: "E321", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: bht.id },
              { substanceName: "Potassium Bromate", substanceType: "specific_chemical", casNumber: "7758-01-2", eenumber: "E924", isMatched: true, matchConfidence: 0.99, matchMethod: "cas_number", ingredientId: potassiumBromate.id },
            ],
          },
        },
      },
    },
  });

  console.log(`✅ Created 2 regulatory sources with rules and substance matches`);

  console.log("\n🎉 Seeding complete!");
  console.log(`   Platform tenant: ${platformTenant.slug}`);
  console.log(`   Demo tenant: ${demoTenant.slug}`);
  console.log(`   Sample data: 8 ingredients, 3 formulations, 3 products, 3 customers, 2 suppliers, 2 regulations`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
