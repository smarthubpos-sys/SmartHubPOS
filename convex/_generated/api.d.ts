/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounting from "../accounting.js";
import type * as announcements from "../announcements.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as bills from "../bills.js";
import type * as biometric from "../biometric.js";
import type * as capital from "../capital.js";
import type * as clients from "../clients.js";
import type * as crons from "../crons.js";
import type * as customerBills from "../customerBills.js";
import type * as dashboard from "../dashboard.js";
import type * as hr from "../hr.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as ledger from "../ledger.js";
import type * as maintenance from "../maintenance.js";
import type * as notifications from "../notifications.js";
import type * as paymentMethods from "../paymentMethods.js";
import type * as payroll from "../payroll.js";
import type * as periodReport from "../periodReport.js";
import type * as permissions from "../permissions.js";
import type * as pinCrypto from "../pinCrypto.js";
import type * as plans from "../plans.js";
import type * as products from "../products.js";
import type * as purchaseReports from "../purchaseReports.js";
import type * as purchasing from "../purchasing.js";
import type * as purchasingEdit from "../purchasingEdit.js";
import type * as reportCore from "../reportCore.js";
import type * as reportEmails from "../reportEmails.js";
import type * as sales from "../sales.js";
import type * as settings from "../settings.js";
import type * as stats from "../stats.js";
import type * as subscriptions from "../subscriptions.js";
import type * as suppliers from "../suppliers.js";
import type * as support from "../support.js";
import type * as surfaceError from "../surfaceError.js";
import type * as tenants from "../tenants.js";
import type * as users from "../users.js";
import type * as waiterCollections from "../waiterCollections.js";
import type * as waiterDirectory from "../waiterDirectory.js";
import type * as waiterOrders from "../waiterOrders.js";
import type * as waiterSettings from "../waiterSettings.js";
import type * as warehouses from "../warehouses.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounting: typeof accounting;
  announcements: typeof announcements;
  attendance: typeof attendance;
  auth: typeof auth;
  bills: typeof bills;
  biometric: typeof biometric;
  capital: typeof capital;
  clients: typeof clients;
  crons: typeof crons;
  customerBills: typeof customerBills;
  dashboard: typeof dashboard;
  hr: typeof hr;
  http: typeof http;
  inventory: typeof inventory;
  ledger: typeof ledger;
  maintenance: typeof maintenance;
  notifications: typeof notifications;
  paymentMethods: typeof paymentMethods;
  payroll: typeof payroll;
  periodReport: typeof periodReport;
  permissions: typeof permissions;
  pinCrypto: typeof pinCrypto;
  plans: typeof plans;
  products: typeof products;
  purchaseReports: typeof purchaseReports;
  purchasing: typeof purchasing;
  purchasingEdit: typeof purchasingEdit;
  reportCore: typeof reportCore;
  reportEmails: typeof reportEmails;
  sales: typeof sales;
  settings: typeof settings;
  stats: typeof stats;
  subscriptions: typeof subscriptions;
  suppliers: typeof suppliers;
  support: typeof support;
  surfaceError: typeof surfaceError;
  tenants: typeof tenants;
  users: typeof users;
  waiterCollections: typeof waiterCollections;
  waiterDirectory: typeof waiterDirectory;
  waiterOrders: typeof waiterOrders;
  waiterSettings: typeof waiterSettings;
  warehouses: typeof warehouses;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
