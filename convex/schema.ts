import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  // ── MULTI-TENANT / MULTI-BRANCH ───────────────────────────────
  tenants: defineTable({ name: v.string(), code: v.string(), isActive: v.boolean(), createdByToken: v.string(), createdAt: v.string(),
    // Subscription: "demo" (3 days) or "paid". planEndsAt = last usable day (YYYY-MM-DD). Missing = legacy business, never expires.
    plan: v.optional(v.string()), planStartsAt: v.optional(v.string()), planEndsAt: v.optional(v.string()), planMonths: v.optional(v.number()), planAmount: v.optional(v.number()),
    // Sidebar modules this business paid for (see MODULES in permissions.ts). Missing = every module (legacy / full plan).
    modules: v.optional(v.array(v.string())) }).index("by_code", ["code"]).index("by_active", ["isActive"]),
  subscriptionPayments: defineTable({ tenantId: v.id("tenants"), amount: v.number(), months: v.number(), startsAt: v.string(), endsAt: v.string(), note: v.optional(v.string()), createdBy: v.optional(v.id("users")), createdAt: v.string() }).index("by_tenant", ["tenantId"]),
  // Ads (banner) and broadcast messages from the Super Admin. tenantId empty = every business.
  announcements: defineTable({
    kind: v.string(), // banner | message
    title: v.string(), body: v.string(),
    imageUrl: v.optional(v.string()), linkUrl: v.optional(v.string()),
    theme: v.optional(v.string()), // blue | green | orange | purple | red
    tenantId: v.optional(v.id("tenants")),
    startsAt: v.optional(v.string()), endsAt: v.optional(v.string()),
    isActive: v.boolean(), createdBy: v.id("users"), createdAt: v.string(),
    clicks: v.optional(v.number()), // banner: how many times users opened its link
  }).index("by_active", ["isActive"]),
  branches: defineTable({ tenantId: v.id("tenants"), name: v.string(), code: v.string(), isActive: v.boolean(), createdAt: v.string() }).index("by_tenant", ["tenantId"]).index("by_tenant_code", ["tenantId", "code"]),
  tenantSettings: defineTable({ tenantId: v.id("tenants"), traIntegrationEnabled: v.boolean(), stockControlEnabled: v.boolean(), traEnvironment: v.optional(v.string()), traTaxpayerId: v.optional(v.string()), defaultCurrency: v.string(), waiterOrdersEnabled: v.optional(v.boolean()), waiterEnabled: v.optional(v.boolean()), waitressEnabled: v.optional(v.boolean()), waiterOrderMode: v.optional(v.union(v.literal("cashier"), v.literal("print"))) }).index("by_tenant", ["tenantId"]),

  // ── USERS & AUTH ──────────────────────────────────────────────
  users: defineTable({
    // Convex Auth-managed profile fields. tokenIdentifier is optional because
    // auth users are created before the application profile is synchronized.
    tokenIdentifier: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    branchPicked: v.optional(v.boolean()), // true when a floating (all-departments) user chose a department to work in
    // Departments this user may work in. branchId = the one he works in NOW; with 2+ ids he switches only between these (top bar).
    branchIds: v.optional(v.array(v.id("branches"))),
    allDepartments: v.optional(v.boolean()), // explicit grant: this (non-manager) user may work in every department
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    username: v.optional(v.string()),
    role: v.optional(v.string()), // admin | manager | cashier | accountant | viewer
    isActive: v.optional(v.boolean()),
    employeeId: v.optional(v.id("employees")),
    requirePasswordChange: v.optional(v.boolean()),
    lastLogin: v.optional(v.string()),
    menuAccess: v.optional(v.array(v.string())), // sidebar modules this user may open (missing = all the business has)
    extraPermissions: v.optional(v.array(v.string())), // permissions given to this ONE user on top of his role (e.g. "sales.void")
    ownDataOnly: v.optional(v.boolean()), // staff mode: sees only his own sales/bills and a personal dashboard
    pinLoginEnabled: v.optional(v.boolean()),
    pinHash: v.optional(v.string()),
    pinFailedAttempts: v.optional(v.number()),
    pinLockedUntil: v.optional(v.number()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_username", ["username"]),

  roles: defineTable({
    name: v.string(), // admin | manager | cashier | accountant | viewer
    displayName: v.string(),
    permissions: v.array(v.string()),
    isSystem: v.boolean(),
    knownKeys: v.optional(v.array(v.string())), // permission keys that existed when the role was last saved (new keys get the built-in default)
  }).index("by_name", ["name"]),

  // ── DASHBOARD ROLL-UPS (small pre-computed numbers so the dashboard never scans invoices/products) ──
  // One row per business + department (branchId empty = records without a department).
  statsTotals: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")),
    receivable: v.number(), payable: v.number(), // kept exact by sales/purchasing mutations, re-checked daily
    productCount: v.number(), lowStock: v.number(), outOfStock: v.number(), inventoryValue: v.number(), billsDue: v.number(),
    topD7: v.array(v.object({ name: v.string(), total: v.number() })),
    topD30: v.array(v.object({ name: v.string(), total: v.number() })),
    topD90: v.array(v.object({ name: v.string(), total: v.number() })),
    refreshedAt: v.number(), // ms; stock figures + top products are refreshed in the background when older than a few minutes
  }).index("by_tenant", ["tenantId"]),
  // One row per business + department + day.
  statsDaily: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")), date: v.string(),
    sales: v.number(), purchases: v.number(), collected: v.number(), invoices: v.number(),
    shard: v.optional(v.number()), // live updates are spread over a few rows per day so simultaneous sales do not collide; readers just add the rows up
  }).index("by_tenant_date", ["tenantId", "date"]).index("by_tenant_date_shard", ["tenantId", "date", "shard"]),
  // Prevents the same business from being recalculated twice at the same time.
  statsJobs: defineTable({ tenantId: v.id("tenants"), queuedAt: v.number() }).index("by_tenant", ["tenantId"]),

  // ── COMPANY ──────────────────────────────────────────────────
  companySettings: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    companyName: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    taxId: v.optional(v.string()),
    website: v.optional(v.string()),
    currency: v.string(), // e.g. "USD"
    currencySymbol: v.string(), // e.g. "$"
    decimalPlaces: v.number(),
    taxRate: v.optional(v.number()),
    taxName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    financialYearStart: v.optional(v.string()), // MM-DD
    invoicePrefix: v.optional(v.string()),
    purchasePrefix: v.optional(v.string()),
    allowNegativeStock: v.optional(v.boolean()),
    inventoryCostingMethod: v.optional(v.string()), // weighted_average | fifo | last_purchase
    traIntegrationEnabled: v.optional(v.boolean()),
    stockControlEnabled: v.optional(v.boolean()),
  }) .index("by_tenant", ["tenantId"]) .index("by_scope", ["tenantId", "branchId"]),

  // ── FINANCIAL PERIODS ────────────────────────────────────────
  financialPeriods: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.string(), // open | closed | locked
    closedBy: v.optional(v.id("users")),
    closedAt: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_status", ["status"]),

  // ── PRODUCT GROUPS ───────────────────────────────────────────
  productGroups: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_code", ["code"]),

  unitsOfMeasure: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    code: v.string(),
    name: v.string(),
    isActive: v.boolean(),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_code", ["code"]),

  // ── PRODUCTS ─────────────────────────────────────────────────
  products: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    itemCode: v.string(),
    partNumber: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    groupId: v.optional(v.id("productGroups")),
    unitId: v.optional(v.id("unitsOfMeasure")),
    openingQty: v.number(),
    currentQty: v.number(),
    lastPurchaseCost: v.optional(v.number()),
    lastPurchaseDate: v.optional(v.string()),
    lastSupplierId: v.optional(v.id("suppliers")),
    weightedAvgCost: v.optional(v.number()),
    sellingPrice: v.number(),
    minStockLevel: v.optional(v.number()),
    reorderLevel: v.optional(v.number()),
    barcode: v.optional(v.string()),
    trackSerialNumbers: v.optional(v.boolean()),
    trackBatchNumbers: v.optional(v.boolean()),
    trackExpiry: v.optional(v.boolean()),
    isActive: v.boolean(),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_itemCode", ["itemCode"])
    .index("by_barcode", ["barcode"])
    .index("by_partNumber", ["partNumber"])
    .index("by_group", ["groupId"]),

  purchasePriceHistory: defineTable({
    productId: v.id("products"),
    purchaseId: v.optional(v.id("purchases")),
    supplierId: v.id("suppliers"),
    cost: v.number(),
    date: v.string(),
    previousCost: v.optional(v.number()),
  })
    .index("by_product", ["productId"])
    .index("by_product_date", ["productId", "date"]),

  // ── SUPPLIERS ────────────────────────────────────────────────
  suppliers: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()), // immediate | 7days | 14days | 30days | custom
    paymentTermsDays: v.optional(v.number()),
    creditLimit: v.optional(v.number()),
    openingBalance: v.number(),
    contactPerson: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_code", ["code"])
    .index("by_name", ["name"]),

  salesSequences: defineTable({ tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")), nextNumber: v.number() }).index("by_scope", ["tenantId", "branchId"]),

  purchaseSequences: defineTable({ tenantId: v.optional(v.id("tenants")), branchId: v.optional(v.id("branches")), nextNumber: v.number() }).index("by_scope", ["tenantId", "branchId"]),

  // ── PURCHASES ────────────────────────────────────────────────
  purchases: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    purchaseDate: v.string(),
    supplierId: v.id("suppliers"),
    supplierInvoiceNo: v.optional(v.string()),
    invoiceNo: v.optional(v.string()),
    internalRef: v.string(),
    subtotal: v.number(),
    discount: v.number(),
    additionalCharges: v.number(),
    taxAmount: v.number(),
    total: v.number(),
    amountPaid: v.number(),
    outstanding: v.number(),
    paymentStatus: v.string(), // unpaid | partial | paid
    status: v.string(), // draft | posted | cancelled
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    postedAt: v.optional(v.string()),
    cancelledAt: v.optional(v.string()),
    cancelledBy: v.optional(v.id("users")),
  }) .index("by_tenant_date", ["tenantId", "purchaseDate"]) .index("by_tenant_status", ["tenantId", "status"]) .index("by_scope", ["tenantId", "branchId"])
    .index("by_supplier", ["supplierId"])
    .index("by_date", ["purchaseDate"])
    .index("by_internalRef", ["internalRef"])
    .index("by_status", ["status"]),

  purchaseLines: defineTable({
    purchaseId: v.id("purchases"),
    productId: v.id("products"),
    qty: v.number(), // stored as exact decimal string representation
    qtyStr: v.string(), // original string for display
    unitCost: v.number(),
    unitCostStr: v.string(),
    lineTotal: v.number(),
    lineTotalStr: v.string(),
    discount: v.number(),
    receivedQty: v.number(),
  }).index("by_purchase", ["purchaseId"]),

  // ── PURCHASE ORDERS ──────────────────────────────────────────
  purchaseOrders: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    orderDate: v.string(),
    supplierId: v.id("suppliers"),
    expectedDelivery: v.optional(v.string()),
    orderRef: v.string(),
    subtotal: v.number(),
    total: v.number(),
    status: v.string(), // draft | pending_approval | approved | partially_received | fully_received | cancelled
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_supplier", ["supplierId"])
    .index("by_status", ["status"])
    .index("by_date", ["orderDate"]),

  purchaseOrderLines: defineTable({
    orderId: v.id("purchaseOrders"),
    productId: v.id("products"),
    qtyOrdered: v.number(),
    unitCost: v.number(),
    lineTotal: v.number(),
    qtyReceived: v.number(),
  }).index("by_order", ["orderId"]),

  // ── GOODS RECEIVED NOTES ─────────────────────────────────────
  goodsReceivedNotes: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    grnRef: v.string(),
    receiptDate: v.string(),
    supplierId: v.id("suppliers"),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    purchaseId: v.optional(v.id("purchases")),
    status: v.string(), // draft | confirmed
    notes: v.optional(v.string()),
    receivedBy: v.id("users"),
    confirmedAt: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_supplier", ["supplierId"])
    .index("by_date", ["receiptDate"])
    .index("by_po", ["purchaseOrderId"]),

  grnLines: defineTable({
    grnId: v.id("goodsReceivedNotes"),
    productId: v.id("products"),
    qtyOrdered: v.number(),
    qtyReceived: v.number(),
    qtyRejected: v.number(),
    unitCost: v.number(),
  }).index("by_grn", ["grnId"]),

  // ── SUPPLIER PAYMENTS ────────────────────────────────────────
  supplierPayments: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    paymentDate: v.string(),
    supplierId: v.id("suppliers"),
    purchaseId: v.optional(v.id("purchases")),
    amount: v.number(),
    paymentMethod: v.string(), // method name (cash | bank | mobile | any custom name)
    paymentMethodId: v.optional(v.id("paymentMethods")),
    receiptNo: v.optional(v.string()), // same value on every split of one receipt
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    voided: v.optional(v.boolean()), // true when the purchase it was paid on was deleted and the money came back
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_supplier", ["supplierId"])
    .index("by_date", ["paymentDate"])
    .index("by_purchase", ["purchaseId"]),

  // ── PURCHASE RETURNS ─────────────────────────────────────────
  purchaseReturns: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    returnDate: v.string(),
    supplierId: v.id("suppliers"),
    purchaseId: v.id("purchases"),
    returnRef: v.string(),
    total: v.number(),
    reason: v.optional(v.string()),
    status: v.string(), // draft | posted
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_supplier", ["supplierId"])
    .index("by_purchase", ["purchaseId"]),

  purchaseReturnLines: defineTable({
    returnId: v.id("purchaseReturns"),
    productId: v.id("products"),
    qty: v.number(),
    unitCost: v.number(),
    lineTotal: v.number(),
  }).index("by_return", ["returnId"]),

  // ── CLIENTS ──────────────────────────────────────────────────
  clients: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    createdByUser: v.optional(v.id("users")), // owner of a customer added by a waiter/cashier
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    taxId: v.optional(v.string()),
    openingBalance: v.number(),
    creditLimit: v.optional(v.number()),
    paymentTerms: v.optional(v.string()),
    paymentTermsDays: v.optional(v.number()),
    contactPerson: v.optional(v.string()),
    notes: v.optional(v.string()),
    creditPolicy: v.string(), // allow | warn | require_approval | block
    isActive: v.boolean(),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_code", ["code"])
    .index("by_name", ["name"]),

  // ── SALES INVOICES ───────────────────────────────────────────
  invoices: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    invoiceNo: v.string(),
    invoiceDate: v.string(),
    clientId: v.id("clients"),
    subtotal: v.number(),
    discount: v.number(),
    taxAmount: v.number(),
    total: v.number(),
    amountPaid: v.number(),
    outstanding: v.number(),
    paymentStatus: v.string(), // unpaid | partial | paid
    status: v.string(), // draft | posted | cancelled
    salespersonId: v.optional(v.id("users")),
    salesSource: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    postedAt: v.optional(v.string()),
    requestKey: v.optional(v.string()), // idempotency key: one client submit = one invoice
  }) .index("by_tenant_date", ["tenantId", "invoiceDate"]) .index("by_tenant_request_key", ["tenantId", "requestKey"]) .index("by_tenant_status", ["tenantId", "status"]) .index("by_tenant_no", ["tenantId", "invoiceNo"]) .index("by_scope", ["tenantId", "branchId"])
    .index("by_tenant_user_date", ["tenantId", "createdBy", "invoiceDate"])
    .index("by_scope_date", ["tenantId", "branchId", "invoiceDate"])
    .index("by_scope_outstanding", ["tenantId", "branchId", "outstanding"])
    .index("by_client", ["clientId"])
    .index("by_date", ["invoiceDate"])
    .index("by_invoiceNo", ["invoiceNo"])
    .index("by_status", ["status"])
    .index("by_tenant_outstanding", ["tenantId", "outstanding"]),

  invoiceLines: defineTable({
    invoiceId: v.id("invoices"),
    productId: v.id("products"),
    qty: v.number(),
    qtyStr: v.string(),
    unitPrice: v.number(),
    unitPriceStr: v.string(),
    lineTotal: v.number(),
    lineTotalStr: v.string(),
    costAtSale: v.number(),
    discount: v.number(),
    returnedQty: v.optional(v.number()), // quantity already taken back by partial sales returns (qty stays the original sold quantity)
  }).index("by_invoice", ["invoiceId"]),

  // ── CUSTOMER PAYMENTS ────────────────────────────────────────
  customerPayments: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    paymentDate: v.string(),
    clientId: v.id("clients"),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    paymentMethod: v.string(),
    paymentMethodId: v.optional(v.id("paymentMethods")),
    receiptNo: v.optional(v.string()), // same value on every split of one receipt
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    voided: v.optional(v.boolean()), // true when the invoice was cancelled and the money refunded
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_client", ["clientId"])
    .index("by_date", ["paymentDate"])
    .index("by_tenant_date", ["tenantId", "paymentDate"])
    .index("by_scope_date", ["tenantId", "branchId", "paymentDate"])
    .index("by_invoice", ["invoiceId"]),

  // ── SALES RETURNS ────────────────────────────────────────────
  salesReturns: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    returnDate: v.string(),
    clientId: v.id("clients"),
    invoiceId: v.id("invoices"),
    returnRef: v.string(),
    total: v.number(), // value returned, tax included
    subtotal: v.optional(v.number()), // value returned before tax
    taxAmount: v.optional(v.number()),
    creditedToDebt: v.optional(v.number()), // part that reduced what the customer still owed
    refunded: v.optional(v.number()), // part paid back to the customer
    refundMethod: v.optional(v.string()),
    reason: v.optional(v.string()),
    status: v.string(),
    createdBy: v.id("users"),
  }).index("by_client", ["clientId"])
    .index("by_scope", ["tenantId", "branchId"])
    .index("by_invoice", ["invoiceId"]),

  salesReturnLines: defineTable({
    returnId: v.id("salesReturns"),
    invoiceLineId: v.id("invoiceLines"),
    productId: v.id("products"),
    qty: v.number(),
    value: v.number(), // net value of the returned quantity (line discount and invoice discount share removed)
    cost: v.number(), // cost of the returned quantity
  }).index("by_return", ["returnId"]),

  // ── WAREHOUSE / STORE STOCK (separate from shop-floor product.currentQty) ──
  warehouses: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")),
    code: v.string(), name: v.string(), kind: v.string(), // warehouse | shop | store
    isActive: v.boolean(), createdBy: v.id("users"), createdAt: v.string(),
  }).index("by_tenant", ["tenantId"]).index("by_tenant_code", ["tenantId", "code"]),
  warehouseStock: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")),
    warehouseId: v.id("warehouses"), productId: v.id("products"), quantity: v.number(),
    averageCost: v.number(), updatedAt: v.string(),
  }).index("by_warehouse", ["warehouseId"]).index("by_product", ["productId"]).index("by_tenant", ["tenantId"]),
  warehouseMovements: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")), warehouseId: v.id("warehouses"),
    productId: v.id("products"), movementType: v.string(), quantityIn: v.number(), quantityOut: v.number(),
    balance: v.number(), unitCost: v.number(), referenceId: v.optional(v.string()), notes: v.optional(v.string()),
    quantityLost: v.optional(v.number()), // in-transit shortage/damage recorded at receipt (no stock moves; value written off)
    reason: v.optional(v.string()), idempotencyKey: v.optional(v.string()),
    createdBy: v.id("users"), createdAt: v.string(),
  }).index("by_warehouse", ["warehouseId"]).index("by_product", ["productId"]).index("by_tenant_date", ["tenantId", "createdAt"]).index("by_tenant_key", ["tenantId", "idempotencyKey"]),
  stockTransfers: defineTable({
    tenantId: v.id("tenants"), branchId: v.optional(v.id("branches")), transferNo: v.string(),
    fromWarehouseId: v.id("warehouses"), toWarehouseId: v.id("warehouses"), status: v.string(), // pending | in_transit | received | cancelled | rejected
    idempotencyKey: v.optional(v.string()), closedBy: v.optional(v.id("users")), closedAt: v.optional(v.string()), closeReason: v.optional(v.string()),
    note: v.optional(v.string()), createdBy: v.id("users"), createdAt: v.string(), dispatchedBy: v.optional(v.id("users")), dispatchedAt: v.optional(v.string()),
    receivedBy: v.optional(v.id("users")), receivedAt: v.optional(v.string()),
  }).index("by_tenant", ["tenantId"]).index("by_status", ["status"]).index("by_tenant_no", ["tenantId", "transferNo"]).index("by_tenant_key", ["tenantId", "idempotencyKey"]),
  stockTransferLines: defineTable({
    tenantId: v.id("tenants"), transferId: v.id("stockTransfers"), productId: v.id("products"), quantity: v.number(), unitCost: v.number(), receivedQuantity: v.optional(v.number()), damagedQuantity: v.optional(v.number()), differenceNote: v.optional(v.string()),
  }).index("by_transfer", ["transferId"]).index("by_tenant", ["tenantId"]),

  // ── STOCK MOVEMENTS ──────────────────────────────────────────
  stockMovements: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    movementDate: v.string(),
    productId: v.id("products"),
    movementType: v.string(), // purchase | sale | adjustment | grn | purchase_return | sale_return | opening
    referenceId: v.optional(v.string()), // purchase/invoice/adjustment id
    referenceType: v.optional(v.string()),
    qtyIn: v.number(),
    qtyOut: v.number(),
    runningBalance: v.number(),
    unitCost: v.optional(v.number()),
    supplierId: v.optional(v.id("suppliers")),
    clientId: v.optional(v.id("clients")),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_product", ["productId"])
    .index("by_tenant_date", ["tenantId", "movementDate"])
    .index("by_date", ["movementDate"])
    .index("by_product_date", ["productId", "movementDate"]),

  // ── STOCK ADJUSTMENTS ────────────────────────────────────────
  stockAdjustments: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    adjustmentDate: v.string(),
    productId: v.id("products"),
    qtyBefore: v.number(),
    adjustmentQty: v.number(),
    qtyAfter: v.number(),
    reason: v.string(),
    reference: v.optional(v.string()),
    status: v.string(), // pending | approved | rejected
    requestedBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_product", ["productId"])
    .index("by_date", ["adjustmentDate"])
    .index("by_status", ["status"]),

  // ── EMPLOYEES ────────────────────────────────────────────────
  employees: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    employeeCode: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    position: v.optional(v.string()),
    department: v.optional(v.string()),
    startDate: v.string(),
    basicSalary: v.number(),
    salaryType: v.string(), // monthly | hourly | daily
    taxId: v.optional(v.string()),
    bankAccount: v.optional(v.string()),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_code", ["employeeCode"])
    .index("by_name", ["name"]),

  attendance: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    employeeId: v.id("employees"),
    date: v.string(),
    signInTime: v.optional(v.string()),
    signOutTime: v.optional(v.string()),
    hoursWorked: v.optional(v.number()),
    status: v.string(), // present | absent | late | half_day
    notes: v.optional(v.string()),
    recordedBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_employee", ["employeeId"])
    .index("by_date", ["date"])
    .index("by_employee_date", ["employeeId", "date"]),

  payrollPeriods: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.string(), // draft | approved | paid
    processedBy: v.optional(v.id("users")),
    processedAt: v.optional(v.string()),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.string()),
    totalGross: v.number(),
    totalDeductions: v.number(),
    totalNet: v.number(),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_status", ["status"]),

  payrollRecords: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    periodId: v.id("payrollPeriods"),
    employeeId: v.id("employees"),
    basicSalary: v.number(),
    allowances: v.number(),
    overtime: v.number(),
    grossPay: v.number(),
    taxDeduction: v.number(),
    otherDeductions: v.number(),
    totalDeductions: v.number(),
    netPay: v.number(),
    paymentStatus: v.string(), // pending | paid
    paidAt: v.optional(v.string()),
    notes: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_period", ["periodId"])
    .index("by_employee", ["employeeId"]),

  // ── CHART OF ACCOUNTS ────────────────────────────────────────
  accounts: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    code: v.string(),
    name: v.string(),
    type: v.string(), // asset | liability | equity | revenue | expense
    subtype: v.optional(v.string()),
    parentId: v.optional(v.id("accounts")),
    balance: v.number(),
    isActive: v.boolean(),
    description: v.optional(v.string()),
    isSystem: v.optional(v.boolean()),
  }) .index("by_tenant_code", ["tenantId", "code"]) .index("by_scope", ["tenantId", "branchId"])
    .index("by_code", ["code"])
    .index("by_type", ["type"]),

  journalEntries: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    entryDate: v.string(),
    reference: v.string(),
    description: v.string(),
    status: v.string(), // draft | posted | reversed
    sourceType: v.optional(v.string()), // manual | purchase | sale | payment | payroll
    sourceId: v.optional(v.string()),
    totalDebit: v.number(),
    totalCredit: v.number(),
    createdBy: v.id("users"),
    postedAt: v.optional(v.string()),
    reversedBy: v.optional(v.id("journalEntries")),
  }) .index("by_tenant_ref", ["tenantId", "reference"]) .index("by_scope", ["tenantId", "branchId"])
    .index("by_date", ["entryDate"])
    .index("by_tenant_date", ["tenantId", "entryDate"])
    .index("by_scope_date", ["tenantId", "branchId", "entryDate"])
    .index("by_reference", ["reference"])
    .index("by_status", ["status"]),

  journalLines: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    entryId: v.id("journalEntries"),
    accountId: v.id("accounts"),
    debit: v.number(),
    credit: v.number(),
    description: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_entry", ["entryId"]).index("by_account", ["accountId"]),

  // ── EXPENSES ─────────────────────────────────────────────────
  expenses: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    expenseDate: v.string(),
    category: v.string(),
    description: v.string(),
    amount: v.number(),
    paymentMethod: v.string(),
    payee: v.optional(v.string()),
    reference: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
    status: v.string(), // pending | approved | paid
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_date", ["expenseDate"])
    .index("by_status", ["status"]),

  // ── SAVED PERIOD REPORTS (day / month / year reports generated from Accounts > Period Report) ──
  reportRuns: defineTable({
    tenantId: v.id("tenants"),
    period: v.string(), // day | month | year
    startDate: v.string(),
    endDate: v.string(),
    scope: v.string(), // "all" or the id of one department
    scopeLabel: v.string(),
    title: v.string(),
    netProfit: v.number(),
    netSales: v.number(),
    totalExpenses: v.number(),
    data: v.string(), // JSON snapshot (sections) so the report can be reopened exactly as it was generated
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.string(),
  }).index("by_tenant", ["tenantId"]),

  // ── AUDIT LOG ────────────────────────────────────────────────
  auditLogs: defineTable({
    tenantId: v.optional(v.id("tenants")),
    userId: v.optional(v.id("users")),
    userName: v.string(),
    action: v.string(),
    module: v.string(),
    referenceId: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    details: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    timestamp: v.string(),
    result: v.string(), // success | failure
  }) .index("by_scope", ["tenantId", "timestamp"])
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_module", ["module"]),

  // ── PAYMENT METHODS (editable list: Cash, several Lipa Namba, several banks, cheque ...) ──
  paymentMethods: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    name: v.string(), // shown to users and stored on every payment, e.g. "M-Pesa 5551234", "CRDB 0150..."
    kind: v.string(), // cash | bank | mobile | cheque | card | other
    accountNo: v.optional(v.string()), // lipa namba / account number
    accountName: v.optional(v.string()),
    isActive: v.boolean(),
    sortOrder: v.number(),
    accountId: v.optional(v.id("accounts")), // the method's own ledger account (cash-kind methods share Cash 1000)
  }) .index("by_scope", ["tenantId", "branchId"]),

  // ── MAINTENANCE: generic per-office settings (hardware, numbering, language, security, taxes, system) ──
  appSettings: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    key: v.string(),
    value: v.string(), // JSON
    updatedAt: v.string(),
    updatedBy: v.optional(v.id("users")),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_key", ["key"]),
  // ── CAPITAL (money brought in to start / fund the business) ──
  capitalReceipts: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    receiptDate: v.string(),
    amount: v.number(),
    sourceType: v.string(), // owner_capital | director_capital | shareholder | bank_loan | director_loan | other_loan | grant | other
    sourceName: v.string(), // who gave it: bank name, director name, ...
    depositMethod: v.string(), // cash | bank | mobile | name of the chosen payment method
    depositMethodId: v.optional(v.id("paymentMethods")),
    reference: v.optional(v.string()),
    interestRate: v.optional(v.number()),
    termMonths: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    journalId: v.optional(v.id("journalEntries")),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_date", ["receiptDate"])
    .index("by_source", ["sourceType"]),

  // ── BILLS (payables that are not supplier purchases: rent, power, water, tax ...) ──
  bills: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    billNumber: v.string(),
    vendor: v.string(),
    category: v.string(), // rent | electricity | water | internet | tax | transport | salary_related | other
    billDate: v.string(),
    dueDate: v.string(),
    amount: v.number(),
    paidAmount: v.number(),
    status: v.string(), // unpaid | partial | paid | void
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_due", ["dueDate"])
    .index("by_status", ["status"]),

  billPayments: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    billId: v.id("bills"),
    paymentDate: v.string(),
    amount: v.number(),
    method: v.string(),
    methodId: v.optional(v.id("paymentMethods")),
    reference: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"]).index("by_bill", ["billId"]),

  // ── HR ──
  leaveRequests: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    employeeId: v.id("employees"),
    leaveType: v.string(), // annual | sick | maternity | paternity | unpaid | other
    startDate: v.string(),
    endDate: v.string(),
    days: v.number(),
    reason: v.optional(v.string()),
    status: v.string(), // pending | approved | rejected | cancelled
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.string()),
    decisionNote: v.optional(v.string()),
    createdBy: v.id("users"),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_employee", ["employeeId"])
    .index("by_status", ["status"]),

  // ── BIOMETRIC (WebAuthn: fingerprint / Face ID / Windows Hello) for attendance ──
  biometricCredentials: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    employeeId: v.id("employees"),
    credentialId: v.string(), // base64url
    publicKey: v.string(), // base64url SPKI
    algorithm: v.number(), // COSE: -7 (ES256) | -257 (RS256)
    counter: v.number(),
    label: v.optional(v.string()),
    createdAt: v.string(),
    lastUsedAt: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_credential", ["credentialId"])
    .index("by_employee", ["employeeId"]),

  biometricChallenges: defineTable({
    challenge: v.string(), // base64url
    purpose: v.string(), // register | auth
    employeeId: v.optional(v.id("employees")),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_challenge", ["challenge"]),

  // ── NOTIFICATIONS (alerts are computed; this only remembers what a user has read) ──
  notificationReads: defineTable({
    userId: v.id("users"),
    key: v.string(),
    readAt: v.string(),
  }).index("by_user", ["userId"]),

  // ── HELP & SUPPORT ──
  // WAITER ORDERS
  waiterOrders: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    customerName: v.string(),
    tableNumber: v.optional(v.string()),
    waiterId: v.id("users"),
    waiterName: v.string(),
    status: v.string(), // placed (stock reduced, not sent) | pending (sent to cashier) | accepted
    stockDeducted: v.optional(v.boolean()),
    sentAt: v.optional(v.string()),
    printedAt: v.optional(v.string()),
    printedAt: v.optional(v.string()),
    cancelledAt: v.optional(v.string()),
    cancelledBy: v.optional(v.id("users")),
    lines: v.array(v.object({
      productId: v.id("products"),
      productName: v.string(),
      qty: v.number(),
      unitPrice: v.number(),
      lineTotal: v.number(),
    })),
    total: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    handledBy: v.optional(v.id("users")),
    handledAt: v.optional(v.string()),
  })
    .index("by_scope_status", ["tenantId", "branchId", "status"])
    .index("by_waiter", ["waiterId"])
    .index("by_created", ["createdAt"]),

  supportTickets: defineTable({
    tenantId: v.optional(v.id("tenants")),
    branchId: v.optional(v.id("branches")),
    subject: v.string(),
    message: v.string(),
    category: v.string(), // question | problem | request | other
    status: v.string(), // open | closed
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.string(),
    reply: v.optional(v.string()),
    repliedBy: v.optional(v.string()),
    repliedAt: v.optional(v.string()),
  }) .index("by_scope", ["tenantId", "branchId"])
    .index("by_user", ["createdBy"])
    .index("by_status", ["status"]),
});
