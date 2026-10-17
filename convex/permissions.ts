/** Permission catalog shared by backend and Role Management screen (no imports on purpose). */
export const PERMISSION_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  { group: "Sales", items: [{ key: "sales.view", label: "View sales and invoices" }, { key: "sales.manage", label: "Create invoices and receive customer payments" }, { key: "sales.edit", label: "Edit saved sales and invoices" }, { key: "sales.print", label: "Print receipts and invoices" }, { key: "sales.export", label: "Export sales data" }, { key: "sales.reports.view", label: "View sales reports" }, { key: "sales.void", label: "Delete / cancel orders (sales invoices): stock returns and money is refunded" }] },
  { group: "Bills", items: [{ key: "bills.all_departments", label: "Combine customer bills across departments (e.g. Kitchen + Bar + Lounge)" }] },
  {
    group: "Stock",
    items: [
      { key: "stock.view", label: "View stock and product lists" },
      { key: "stock.manage", label: "Add products, groups and units, import new products" },
      { key: "stock.reports.view", label: "View stock reports" },
      { key: "stock.print", label: "Print stock reports and labels" },
      { key: "stock.export", label: "Export stock data" },
      { key: "stock.store.view", label: "View Store/Ghala stock and transfers" },
      { key: "stock.store.manage", label: "Create and manage Store/Ghala locations" },
      { key: "stock.store.receive", label: "Receive goods into Store/Ghala" },
      { key: "stock.store.transfer", label: "Create stock transfers" },
      { key: "stock.store.dispatch", label: "Dispatch stock transfers from source warehouse" },
      { key: "stock.store.receive_transfer", label: "Confirm receipt of transfers and record differences" },
      { key: "stock.adjust", label: "Change / delete stock: quantity adjustment, reconciliation, edit or deactivate existing items (Super Admin gives this one)" },
    ],
  },
  {
    group: "Purchasing",
    items: [
      { key: "suppliers.view", label: "View suppliers" },
      { key: "suppliers.manage", label: "Add / modify suppliers" },
      { key: "purchasing.view", label: "View purchases and purchase orders" },
      { key: "purchasing.manage", label: "Purchase entry, orders, GRN, returns, supplier payments" },
      { key: "purchasing.reports.view", label: "View purchase reports" },
      { key: "purchasing.print", label: "Print purchase documents" },
      { key: "purchasing.export", label: "Export purchase data" },
      { key: "purchasing.edit", label: "Edit purchase invoices, purchase orders and GRNs" },
      { key: "purchasing.delete", label: "Delete / cancel purchase invoices, orders, GRNs and purchase returns" },
    ],
  },
  { group: "Payroll", items: [{ key: "payroll.view", label: "View payroll" }, { key: "payroll.manage", label: "Manage employees and payroll" }, { key: "payroll.approve", label: "Approve payroll" }, { key: "payroll.reports.view", label: "View payroll reports" }, { key: "payroll.print", label: "Print payroll reports" }, { key: "payroll.export", label: "Export payroll data" }] },
  { group: "Accounts", items: [{ key: "accounts.view", label: "View accounts and balances" }, { key: "accounts.manage", label: "Post journals and manage chart of accounts" }, { key: "accounts.approve", label: "Approve accounting entries" }, { key: "accounts.reports.view", label: "View financial reports" }, { key: "accounts.print", label: "Print financial reports" }, { key: "accounts.export", label: "Export financial data" }] },
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

/** Permissions that can also be given to ONE user directly (on top of his role) from the Users form. */
export const USER_GRANTABLE_PERMISSIONS: { key: string; label: string }[] = [
  { key: "sales.void", label: "Anaweza kufuta / kubatilisha oda (invoice) za Sales" },
  { key: "purchasing.edit", label: "Anaweza ku-edit Purchase (invoice, order, GRN)" },
  { key: "purchasing.delete", label: "Anaweza kufuta Purchase (invoice, order, GRN, return)" },
  { key: "stock.adjust", label: "Anaweza kubadili / kufuta stock (adjustment, kuhariri bidhaa) â€” Super Admin pekee ndiye anayetoa" },
];

/**
 * Permissions nobody gets by default: not Administrator, not Manager, not an "owner" wildcard. They exist only when the Super Admin
 * ticks them for a role (Role Management) or for one user (Users form) - that can be a cashier too. Only a Super Admin may give or take them away.
 */
export const SUPER_ADMIN_ONLY_PERMISSIONS = ["stock.adjust"];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/**
 * Permissions added after the first release. A role saved before they existed has no opinion about them.
 * sales.view / sales.print are listed because the built-in Cashier used to be just ["sales.manage"]: a Cashier row saved in that era
 * (no knownKeys) would otherwise stay without them and every Sales screen would be refused. Rows saved later keep their own choice.
 */
export const LATE_PERMISSIONS = ["sales.view", "sales.print", "sales.void", "purchasing.edit", "purchasing.delete", "stock.adjust", "stock.store.view", "stock.store.manage", "stock.store.receive", "stock.store.transfer", "stock.store.dispatch", "stock.store.receive_transfer"];

export const SYSTEM_ROLES: { name: string; displayName: string; permissions: string[] }[] = [
  { name: "admin", displayName: "Administrator", permissions: ALL_PERMISSION_KEYS.filter((k) => k !== "maintenance.roles" && !SUPER_ADMIN_ONLY_PERMISSIONS.includes(k)) },
  { name: "manager", displayName: "Manager", permissions: ["system.manager", "sales.view", "sales.manage", "sales.edit", "sales.print", "sales.export", "sales.reports.view", "sales.void", "stock.view", "stock.manage", "stock.reports.view", "stock.print", "stock.export", "stock.store.view", "stock.store.manage", "stock.store.receive", "stock.store.transfer", "stock.store.dispatch", "stock.store.receive_transfer", "suppliers.view", "suppliers.manage", "purchasing.view", "purchasing.manage", "purchasing.reports.view", "purchasing.print", "purchasing.export", "purchasing.edit", "purchasing.delete", "payroll.view", "payroll.manage", "payroll.approve", "payroll.reports.view", "payroll.print", "payroll.export", "accounts.view", "accounts.manage", "accounts.approve", "accounts.reports.view", "accounts.print", "accounts.export", "bills.all_departments", "maintenance.company", "maintenance.periods", "maintenance.audit.view"] },
  // Accountant: every FINANCIAL view (accounts, profit/loss, sales / purchase / stock reports incl. cost and margins, payroll cost reports).
  // Read, print and export only: no selling, no stock or purchase entry, no void/edit/delete, no user or role management.
  { name: "accountant", displayName: "Accountant", permissions: ["accounts.view", "accounts.reports.view", "accounts.print", "accounts.export", "sales.view", "sales.print", "sales.export", "sales.reports.view", "purchasing.view", "purchasing.print", "purchasing.export", "purchasing.reports.view", "suppliers.view", "stock.view", "stock.print", "stock.export", "stock.reports.view", "payroll.view", "payroll.reports.view", "payroll.print", "payroll.export", "maintenance.periods", "maintenance.audit.view"] },
  { name: "cashier", displayName: "Cashier", permissions: ["sales.view", "sales.manage", "sales.print"] },
  // Waiter / Waitress: everyday selling only (take orders and invoices, receive payments, returns, print receipts and bills).
  // No sales reports, no export, no edit/void, no stock, purchasing, accounts or payroll. Use "own data only" on the user to limit them to their own invoices.
  { name: "waiter", displayName: "Waiter", permissions: ["sales.view", "sales.manage", "sales.print"] },
  { name: "waitress", displayName: "Waitress", permissions: ["sales.view", "sales.manage", "sales.print"] },
  { name: "viewer", displayName: "Viewer", permissions: [] },
];

/**
 * A system role (Manager, Admin ...) that was customised and saved BEFORE a permission existed would never receive that permission,
 * so the new switch stayed hidden even for managers. Keys the saved role did not know about (`knownKeys`, written on every save)
 * now get the built-in default of that role; once the role is saved again its own choice always wins.
 */
export function permissionsWithNewDefaults(
  roleName: string,
  stored: string[],
  knownKeys: string[] | undefined,
): string[] {
  const system = SYSTEM_ROLES.find((r) => r.name === roleName);
  if (!system) return stored;

  const previousDefaults: Record<string, string[]> = {
    accountant: [
      "accounts.manage",
      "suppliers.view",
      "maintenance.periods",
      "maintenance.audit.view",
    ],
    manager: ["system.manager", "sales.manage", "purchasing.manage"],
    cashier: ["sales.manage"],
    waiter: [],
    waitress: [],
  };

  if (!knownKeys) {
    const previous = previousDefaults[roleName];

    const matchesPreviousExactly =
      previous !== undefined &&
      stored.length === previous.length &&
      previous.every((key) => stored.includes(key));

    if (matchesPreviousExactly) return [...system.permissions];

    return stored;
  }

  const known = new Set(knownKeys);
  const add = system.permissions.filter(
    (key) => !known.has(key) && !stored.includes(key),
  );

  return add.length ? [...stored, ...add] : stored;
}

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
