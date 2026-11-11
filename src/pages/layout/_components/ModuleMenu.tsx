import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import { tr } from "@/lib/i18n.ts";

type MenuItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  description: string;
};

type MenuSection = {
  section: string;
  items: MenuItem[];
};

type Props = {
  title: string;
  sections: MenuSection[];
  onClose: () => void;
  variant?: "default" | "accounts";
  /** Shown between the header and the menu sections (for example summary cards). */
  children?: ReactNode;
};

export default function ModuleMenu({ title, sections, onClose, variant = "default", children }: Props) {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer text-sm"
        >
          <X className="w-4 h-4" />
          
          {tr("Close")}
        </button>
      </div>

      {children}

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.section}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              {section.section}
            </h3>
            <div className={variant === "accounts" ? "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"}>
              {section.items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={variant === "accounts" ? "group flex min-h-[68px] items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-all hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : "lift flex flex-col items-start gap-2 p-3.5 bg-card border border-border/60 rounded-2xl hover:border-primary/40 cursor-pointer text-left group"}
                >
                  <div className={variant === "accounts" ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary" : "p-2 rounded-xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary group-hover:from-primary group-hover:to-accent group-hover:text-primary-foreground transition-colors"}>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground leading-tight">{item.label}</p>
                    <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">{item.description}</p>
                  </div>
                  {variant === "accounts" && <span className="text-xs text-muted-foreground transition-transform group-hover:translate-x-0.5">→</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
