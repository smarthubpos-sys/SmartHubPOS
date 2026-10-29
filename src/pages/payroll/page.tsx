import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { LogIn, LogOut, DollarSign, UserPlus, LayoutList, FileText, BarChart2, CreditCard, User, CalendarClock, Scale, ClockAlert } from "lucide-react";
import AttendancePage from "@/pages/payroll/Attendance.tsx";
import ProcessPayroll from "@/pages/payroll/Process.tsx";
import Placement from "@/pages/payroll/Placement.tsx";
import Payslip from "@/pages/payroll/Payslip.tsx";
import PayrollReports from "@/pages/payroll/Reports.tsx";
import Schedules from "@/pages/payroll/Schedules.tsx";
import AttendanceRules from "@/pages/payroll/AttendanceRules.tsx";
import AttendanceReport from "@/pages/payroll/AttendanceReport.tsx";
import EmployeesPanel from "@/pages/hr/EmployeesPanel.tsx";
import { PageHeader } from "@/components/page-kit.tsx";
import { tr } from "@/lib/i18n.ts";

const payrollMenuItems = [
  {
    section: tr("Attendance"),
    items: [
      { label: tr("Staff Sign In"), icon: LogIn, path: "/payroll/sign-in", description: tr("Record employee sign-in") },
      { label: tr("Staff Sign Out"), icon: LogOut, path: "/payroll/sign-out", description: tr("Record employee sign-out") },
      { label: tr("Staff Schedules"), icon: CalendarClock, path: "/payroll/schedules", description: tr("Siku, muda wa kuingia na kutoka") },
      { label: tr("Attendance Deductions"), icon: Scale, path: "/payroll/deductions", description: tr("Makato ya kuchelewa na kutokuwepo") },
    ],
  },
  {
    section: tr("Payroll Processing"),
    items: [
      { label: tr("Process Payroll"), icon: DollarSign, path: "/payroll/process", description: tr("Calculate and run payroll") },
      { label: tr("Add / Modify Employee"), icon: UserPlus, path: "/payroll/employees", description: tr("Manage employee records") },
      { label: tr("Payroll Placement"), icon: LayoutList, path: "/payroll/placement", description: tr("Assign payroll groups") },
      { label: tr("Payslip"), icon: FileText, path: "/payroll/payslip", description: tr("Generate payslips") },
    ],
  },
  {
    section: tr("Payroll Reports"),
    items: [
      { label: tr("Payroll Report"), icon: BarChart2, path: "/payroll/reports/summary", description: tr("Payroll summary") },
      { label: tr("Payroll Payment Report"), icon: CreditCard, path: "/payroll/reports/payments", description: tr("Payment records") },
      { label: tr("Employee Statement"), icon: User, path: "/payroll/reports/employee-statement", description: tr("Per-employee history") },
      { label: tr("Late & Absence Report"), icon: ClockAlert, path: "/payroll/reports/attendance", description: tr("Waliochelewa na wasioingia") },
    ],
  },
];

export default function PayrollPage() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Payroll")}
            sections={payrollMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="sign-in" element={<AttendancePage key="attendance-in" kind="in" />} />
      <Route path="sign-out" element={<AttendancePage key="attendance-out" kind="out" />} />
      <Route path="schedules" element={<Schedules />} />
      <Route path="deductions" element={<AttendanceRules />} />
      <Route path="reports/attendance" element={<AttendanceReport />} />
      <Route path="process" element={<ProcessPayroll />} />
      <Route path="employees" element={<div className="mx-auto max-w-6xl space-y-4"><PageHeader title={tr("Add / Modify Employee")} subtitle={tr("Manage employee records")} /><EmployeesPanel /></div>} />
      <Route path="placement" element={<Placement />} />
      <Route path="payslip" element={<Payslip />} />
      <Route path="reports/summary" element={<PayrollReports mode="summary" />} />
      <Route path="reports/payments" element={<PayrollReports mode="payments" />} />
      <Route path="reports/employee-statement" element={<PayrollReports mode="employee" />} />
      <Route path="*" element={<AttendancePage key="attendance-default" kind="in" />} />
    </Routes>
  );
}
