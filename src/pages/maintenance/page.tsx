import { useNavigate, Routes, Route } from "react-router-dom";
import ModuleMenu from "@/pages/layout/_components/ModuleMenu.tsx";
import { Database, CreditCard, Settings, Monitor, UserCog, Shield, Users, HardDrive, Eraser, FileSearch, DollarSign, Hash, Building, Globe, Calendar } from "lucide-react";
import ComingSoon from "@/pages/layout/_components/ComingSoon.tsx";
import { CompanyPage, CurrencyPage, HardwarePage, LanguagePage, NumberingPage, SystemSetupPage, TaxPage } from "./SettingsPages.tsx";
import PeriodsPage from "./PeriodsPage.tsx";
import PaymentMethodsPage from "./PaymentMethodsPage.tsx";
import UsersPage from "./UsersPage.tsx";
import SecurityPage from "./SecurityPage.tsx";
import RolesPage from "./RolesPage.tsx";
import { AuditPage, BackupPage, ClearDataPage, DatabasePage } from "./DataPages.tsx";
import { tr } from "@/lib/i18n.ts";

const maintenanceMenuItems = [
  {
    section: tr("System"),
    items: [
      { label: tr("System Setup"), icon: Settings, path: "/maintenance/system-setup", description: tr("General system settings") },
      { label: tr("Company Information"), icon: Building, path: "/maintenance/company", description: tr("Business details and branding") },
      { label: tr("Hardware Setup"), icon: Monitor, path: "/maintenance/hardware", description: tr("Printers, scanners, peripherals") },
      { label: tr("Currency Settings"), icon: DollarSign, path: "/maintenance/currency", description: tr("Currency and formatting") },
      { label: tr("Njia za Malipo"), icon: CreditCard, path: "/maintenance/payment-methods", description: tr("Lipa Namba, benki, cash — ongeza na hariri") },
      { label: tr("Tax Settings"), icon: Hash, path: "/maintenance/tax", description: tr("Tax rates and rules") },
      { label: tr("Document Numbering"), icon: FileSearch, path: "/maintenance/numbering", description: tr("Prefix and sequence settings") },
      { label: tr("Financial Period Settings"), icon: Calendar, path: "/maintenance/periods", description: tr("Year and period config") },
      { label: tr("Language Settings"), icon: Globe, path: "/maintenance/language", description: tr("Interface language") },
    ],
  },
  {
    section: tr("Users and Security"),
    items: [
      { label: tr("User Settings"), icon: UserCog, path: "/maintenance/users", description: tr("Add and modify users") },
      { label: tr("User Security Settings"), icon: Shield, path: "/maintenance/security", description: tr("Password and session policy") },
      { label: tr("Role Management"), icon: Users, path: "/maintenance/roles", description: tr("Define roles and permissions") },
    ],
  },
  {
    section: tr("Data Management"),
    items: [
      { label: tr("Backup and Restore"), icon: HardDrive, path: "/maintenance/backup", description: tr("Database backup and recovery") },
      { label: tr("Audit Trail"), icon: FileSearch, path: "/maintenance/audit", description: tr("System activity log") },
      { label: tr("Database Maintenance"), icon: Database, path: "/maintenance/database", description: tr("Re-index and optimize") },
      { label: tr("Clear Data File"), icon: Eraser, path: "/maintenance/clear-data", description: tr("Delete invoices, purchases, stock…") },
    ],
  },
];

export default function MaintenancePage() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ModuleMenu
            title={tr("Maintenance")}
            sections={maintenanceMenuItems}
            onClose={() => navigate("/dashboard")}
          />
        }
      />
      <Route path="system-setup" element={<SystemSetupPage />} />
      <Route path="company" element={<CompanyPage />} />
      <Route path="hardware" element={<HardwarePage />} />
      <Route path="currency" element={<CurrencyPage />} />
      <Route path="tax" element={<TaxPage />} />
      <Route path="payment-methods" element={<PaymentMethodsPage />} />
      <Route path="numbering" element={<NumberingPage />} />
      <Route path="periods" element={<PeriodsPage />} />
      <Route path="language" element={<LanguagePage />} />
      <Route path="users" element={<UsersPage />} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="roles" element={<RolesPage />} />
      <Route path="backup" element={<BackupPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="database" element={<DatabasePage />} />
      <Route path="clear-data" element={<ClearDataPage />} />
      <Route path="*" element={<ComingSoon module="Maintenance" onBack={() => navigate("/maintenance")} />} />
    </Routes>
  );
}
