/** Permission catalog shared by backend and Role Management screen (no imports on purpose). */
export const PERMISSION_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  { group: "Sales", items: [{ key: "sales.manage", label: "Create invoices and receive customer payments" }] },
  { group: "Bills", items: [{ key: "bills.all_departments", label: "Combine customer bills across departments (e.g. Kitchen + Bar + Lounge)" }] },
  { group: "Stock", items: [{ key: "stock.manage", label: "Manage products and stock adjustments" }] },
  {
    group: "Purchasing",
    items: [
      { key: "suppliers.view", label: "View suppliers" },
      { key: "suppliers.manage", label: "Add / modify suppliers" },
      { key: "purchasing.manage", label: "Purchase entry, orders, GRN, returns, supplier payments" },
    ],
  },
  { group: "Payroll", items: [{ key: "payroll.manage", label: "Manage employees and payroll" }] },
  { group: "Accounts", items: [{ key: "accounts.manage", label: "Post journals and manage chart of accounts" }] },
  {
    group: "Maintenance",
    items: [
      { key: "system.manager", label: "General manager access (all manager-only operations)" },
      { key: "maintenance.system", label: "System setup" },
      { key: "maintenance.company", label: "Company information and currency" },
      { key: "maintenance.hardware", label: "Hardware setup" },
      { key: "maintenance.tax", label: "Tax settings" },
      { key: "maintenance.numbering", label: "Document numbering" },
      { key: "maintenance.periods", label: "Financial periods" },
      { key: "maintenance.language", label: "Language settings" },
      { key: "maintenance.users", label: "Add and modify users" },
      { key: "maintenance.security", label: "User security settings" },
      { key: "maintenance.roles", label: "Role management" },
      { key: "maintenance.audit.view", label: "View audit trail" },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const SYSTEM_ROLES: { name: string; displayName: string; permissions: string[] }[] = [
  { name: "admin", displayName: "Administrator", permissions: ALL_PERMISSION_KEYS.filter((k) => k !== "maintenance.roles") },
  { name: "manager", displayName: "Manager", permissions: ["system.manager", "sales.manage", "stock.manage", "suppliers.view", "suppliers.manage", "purchasing.manage", "payroll.manage", "accounts.manage", "bills.all_departments", "maintenance.company", "maintenance.periods", "maintenance.audit.view"] },
  { name: "accountant", displayName: "Accountant", permissions: ["accounts.manage", "suppliers.view", "maintenance.periods", "maintenance.audit.view"] },
  { name: "cashier", displayName: "Cashier", permissions: ["sales.manage"] },
  { name: "viewer", displayName: "Viewer", permissions: [] },
];

/** Keys accepted by maintenance.saveSetting and the permission each one needs. */
export const SETTING_KEYS: Record<string, string> = {
  system: "maintenance.system",
  hardware: "maintenance.hardware",
  taxes: "maintenance.tax",
  numbering: "maintenance.numbering",
  language: "maintenance.language",
  security: "maintenance.security",
};

/**
 * Sidebar modules. A business only gets the modules it paid for (tenants.modules), and inside a business
 * every user can be limited further (users.menuAccess). Keys are also the first path segment of each screen.
 * Shared by backend and screens (no imports on purpose).
 */
export const MODULES: { key: string; label: string; path: string; core?: boolean }[] = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", core: true },
  { key: "sales", label: "Sales", path: "/sales" },
  { key: "stock", label: "Stock", path: "/stock" },
  { key: "purchasing", label: "Purchasing", path: "/purchasing" },
  { key: "accounts", label: "Accounts", path: "/accounts" },
  { key: "bills", label: "Bills", path: "/bills" },
  { key: "payroll", label: "Payroll", path: "/payroll" },
  { key: "hr", label: "HR", path: "/hr" },
  { key: "notifications", label: "Notifications", path: "/notifications" },
  { key: "help", label: "Help & Support", path: "/help", core: true },
  { key: "maintenance", label: "Maintenance", path: "/maintenance" },
];
export const ALL_MODULE_KEYS = MODULES.map((m) => m.key);
export const CORE_MODULE_KEYS = MODULES.filter((m) => m.core).map((m) => m.key);

/** Ready-made packages the Super Admin can pick for a business (it can still tick/untick each module). */
export const MODULE_PRESETS: { key: string; label: string; modules: string[] }[] = [
  { key: "basic", label: "Basic (Sales + Bills)", modules: ["dashboard", "sales", "bills", "notifications", "help", "maintenance"] },
  { key: "standard", label: "Standard (+ Stock, Purchasing)", modules: ["dashboard", "sales", "stock", "purchasing", "bills", "notifications", "help", "maintenance"] },
  { key: "full", label: "Full (all modules)", modules: ALL_MODULE_KEYS },
];

/** Removes unknown keys and always keeps the core modules. */
export function cleanModules(keys: string[]): string[] {
  const wanted = new Set([...keys, ...CORE_MODULE_KEYS]);
  return ALL_MODULE_KEYS.filter((k) => wanted.has(k));
}

/**
 * Modules a user may open. `tenantModules` undefined = the business has everything; `menuAccess` undefined = the user
 * gets everything the business has. Returns null when nothing is restricted (= all modules).
 */
export function effectiveModules(tenantModules: string[] | undefined, menuAccess: string[] | undefined): string[] | null {
  if (!tenantModules && !menuAccess) return null;
  const base = tenantModules ? cleanModules(tenantModules) : ALL_MODULE_KEYS;
  const mine = menuAccess ? new Set(cleanModules(menuAccess)) : null;
  return base.filter((k) => !mine || mine.has(k));
}
