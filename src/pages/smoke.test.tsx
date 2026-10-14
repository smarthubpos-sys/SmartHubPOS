import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";

const day = new Date().toISOString().slice(0, 10);
const emp = { _id: "e1", employeeCode: "EMP-001", name: "Asha", startDate: "2026-01-01", basicSalary: 300000, salaryType: "monthly", isActive: true, department: "Mauzo", position: "Keshia" };
const data: Record<string, unknown> = {
  "dashboard:getMetrics": { todaySales: 1000, todayCash: 800, todayPurchaseTotal: 500, totalOutstandingCustomer: 200, totalOutstandingSupplier: 100, inventoryValue: 9000, lowStockItems: 2, outOfStockItems: 1, recentInvoices: [{ _id: "i1", invoiceNo: "INV-1", invoiceDate: day, total: 1000, paymentStatus: "paid" }], recentPurchases: [{ _id: "p1", internalRef: "PUR-1", purchaseDate: day, total: 500, paymentStatus: "partial" }] },
  "dashboard:getSettings": { companyName: "Duka", currencySymbol: "TSh", decimalPlaces: 0 },
  "dashboard:getCharts": { daily: [{ date: day, sales: 10, purchases: 5, collected: 7 }], topProducts: [{ name: "Sukari", total: 50 }], stockHealth: { ok: 3, low: 1, out: 1 }, receivable: 5, payable: 3, billsDue: 2, totals: { sales: 10, purchases: 5, invoices: 1 } },
  "capital:list": [{ _id: "c1", receiptDate: day, amount: 1000000, sourceType: "bank_loan", sourceName: "CRDB", depositMethod: "bank", interestRate: 14, termMonths: 12 }],
  "bills:list": [{ _id: "b1", billNumber: "BILL-0001", vendor: "TANESCO", category: "electricity", billDate: day, dueDate: "2020-01-01", amount: 1000, paidAmount: 0, status: "unpaid" }],
  "bills:payments": [],
  "clients:list": [{ _id: "c1", code: "C1", name: "Mteja Mmoja", isActive: true }],
  "hr:overview": { total: 2, active: 2, present: 1, onLeave: 0, pendingLeave: 1, departments: [{ name: "Mauzo", count: 2 }] },
  "hr:listLeave": [],
  "payroll:listEmployees": [emp],
  "payroll:listPeriods": [{ _id: "pp1", name: "Test", startDate: day, endDate: day, status: "draft", totalGross: 1, totalDeductions: 0, totalNet: 1 }],
  "payroll:listRecords": [],
  "biometric:listCredentials": [{ _id: "cr1", employeeId: "e1", createdAt: day }],
  "attendance:today": [{ employeeId: "e1", code: "EMP-001", name: "Asha", signInTime: "08:00", status: "present" }],
  "attendance:range": [],
  "notifications:feed": { items: [{ key: "k", code: "low_stock", level: "warning", params: { name: "Sukari", qty: 1, level: 5 }, link: "/stock", at: day, read: false }], unread: 1 },
  "support:list": [],
  "users:getCurrentUser": { name: "Boss", role: "manager" },
  "products:listGroups": [{ _id: "g", name: "Chakula" }],
  "products:listUnits": [{ _id: "u", name: "Kg" }],
};
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => Object.assign(vi.fn(), { withOptimisticUpdate: () => vi.fn() }),
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
}));
vi.mock("recharts", async () => {
  const React = await import("react");
  const Box = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  const names = ["ResponsiveContainer", "AreaChart", "Area", "BarChart", "Bar", "CartesianGrid", "XAxis", "YAxis", "Tooltip", "Legend", "PieChart", "Pie", "Cell"];
  return Object.fromEntries(names.map((n) => [n, Box]));
});

import Dashboard from "@/pages/dashboard/page.tsx";
import CapitalPage from "@/pages/accounts/CapitalPage.tsx";
import BillsPage from "@/pages/bills/page.tsx";
import ExpensesPage from "@/pages/accounts/ExpensesPage.tsx";
import HRPage from "@/pages/hr/page.tsx";
import NotificationsPage from "@/pages/notifications/page.tsx";
import HelpPage from "@/pages/help/page.tsx";
import StockImport from "@/pages/stock/StockImport.tsx";
import AttendancePage from "@/pages/payroll/Attendance.tsx";
import ProcessPayroll from "@/pages/payroll/Process.tsx";
import Placement from "@/pages/payroll/Placement.tsx";
import Payslip from "@/pages/payroll/Payslip.tsx";
import PayrollReports from "@/pages/payroll/Reports.tsx";
import EmployeesPanel from "@/pages/hr/EmployeesPanel.tsx";

const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("new pages render with data", () => {
  it.each([
    ["Dashboard", <Dashboard />, "Duka"],
    ["Capital", <CapitalPage />, "Mapokezi ya Mtaji"],
    ["Bills", <BillsPage />, "Chagua mteja ili kuona invoice zake."],
    ["Expenses", <ExpensesPage />, "TANESCO"],
    ["HR", <HRPage />, "Rasilimali Watu (HR)"],
    ["Notifications", <NotificationsPage />, "Bidhaa inaisha: Sukari"],
    ["Help", <HelpPage />, "Maswali yanayoulizwa mara nyingi"],
    ["StockImport", <StockImport />, "Ingiza bidhaa kwa Excel"],
    ["Attendance", <AttendancePage kind="in" />, "Mahudhurio ya leo"],
    ["Process", <ProcessPayroll />, "Vipindi vya mishahara"],
    ["Placement", <Placement />, "Asha"],
    ["Payslip", <Payslip />, "Hati ya Mshahara (Payslip)"],
    ["Reports", <PayrollReports mode="summary" />, "Ripoti ya Mishahara"],
    ["Employees", <EmployeesPanel />, "EMP-001"],
  ])("%s", (_n, el, text) => {
    wrap(el);
    expect(screen.getAllByText(new RegExp(text.replace(/[()]/g, "\\$&"), "i")).length).toBeGreaterThan(0);
  });
});
