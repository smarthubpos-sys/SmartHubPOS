import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
};

export default function ModuleMenu({ title, sections, onClose }: Props) {
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

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.section}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              {section.section}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {section.items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="lift flex flex-col items-start gap-2 p-3.5 bg-card border border-border/60 rounded-2xl hover:border-primary/40 cursor-pointer text-left group"
                >
                  <div className="p-2 rounded-xl bg-gradient-to-br from-primary/15 to-accent/15 text-primary group-hover:from-primary group-hover:to-accent group-hover:text-primary-foreground transition-colors">
                    <item.icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="text-sm font-medium text-foreground leading-tight">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-tight truncate">{item.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
