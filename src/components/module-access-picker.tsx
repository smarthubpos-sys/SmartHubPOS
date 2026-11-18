import { useState } from "react";
import { MODULES, modulePermissionItems } from "@/convex/permissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tr } from "@/lib/i18n.ts";

type Props = {
  /** Modules this user may open (menuAccess). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Modules the business has (undefined = all). */
  available?: string[];
  /** When true every module the business has is open to this user: the boxes are shown ticked and locked, only the permission windows work. */
  allModules?: boolean;
  /** What his ROLE already gives. */
  rolePermissions: string[];
  /** Given to this one person on top of the role / switched off for this one person. */
  extra: string[];
  denied: string[];
  onPermissionsChange: (extra: string[], denied: string[]) => void;
  /** Permissions the person filling the form has himself (null = no limit, Super Admin). Others are shown but locked. */
  myPermissions: string[] | null;
  disabled?: boolean;
};

/**
 * Sidebar modules for ONE user. Ticking a module (Sales, Stock, Accounts ...) opens a window where the administrator ticks
 * what that person may see and do inside it; the same window opens later with the "Ruhusa" button.
 * Result = role permissions + `extra` - `denied`. A permission that the role already gives is "switched off" with `denied`,
 * one the role does not give is "switched on" with `extra`.
 */
export default function ModuleAccessPicker({ value, onChange, available, allModules = false, rolePermissions, extra, denied, onPermissionsChange, myPermissions, disabled = false }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shown = MODULES.filter((m) => !available || available.includes(m.key));
  const isOn = (k: string) => (rolePermissions.includes(k) || extra.includes(k)) && !denied.includes(k);
  const canTick = (k: string) => myPermissions === null || myPermissions.includes(k);

  const setMany = (keys: string[], on: boolean) => {
    const ex = new Set(extra);
    const dn = new Set(denied);
    for (const k of keys) {
      if (!canTick(k)) continue;
      const inRole = rolePermissions.includes(k);
      if (on) { dn.delete(k); if (!inRole) ex.add(k); }
      else { ex.delete(k); if (inRole) dn.add(k); }
    }
    onPermissionsChange([...ex], [...dn]);
  };
  const resetToRole = (keys: string[]) => onPermissionsChange(extra.filter((k) => !keys.includes(k)), denied.filter((k) => !keys.includes(k)));

  const toggleModule = (key: string, on: boolean) => {
    onChange(on ? [...new Set([...value, key])] : value.filter((k) => k !== key));
    if (on && modulePermissionItems(key).length > 0) setOpenKey(key); // choosing a module opens the window to tick what he sees inside it
  };

  const openModule = MODULES.find((m) => m.key === openKey);
  const items = openKey ? modulePermissionItems(openKey) : [];

  return (
    <>
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {shown.map((m) => {
          const locked = !!m.core || allModules;
          const checked = locked || value.includes(m.key);
          const list = modulePermissionItems(m.key);
          const on = list.filter((i) => isOn(i.key)).length;
          return (
            <div key={m.key} className="flex items-center justify-between gap-2">
              <label className={`flex items-center gap-2 text-sm ${locked || disabled ? "opacity-70" : "cursor-pointer"}`}>
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={checked} disabled={locked || disabled} onChange={(e) => toggleModule(m.key, e.target.checked)} />
                {tr(m.label)}
              </label>
              {checked && list.length > 0 && (
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={disabled} onClick={() => setOpenKey(m.key)}>
                  {tr("Ruhusa")} {on}/{list.length}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!openKey} onOpenChange={(o) => { if (!o) setOpenKey(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tr("{0}: anachoweza kuona na kufanya", [tr(openModule?.label ?? "")])}</DialogTitle>
            <DialogDescription>{tr("Tia tiki kile mtumiaji huyu anachoruhusiwa kwenye sehemu hii. Kisichotiwa tiki hakitaonekana kwake na hawezi kukifanya.")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {items.map((i) => {
              const locked = !canTick(i.key);
              return (
                <label key={i.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${locked ? "opacity-60" : "cursor-pointer"}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer accent-primary" checked={isOn(i.key)} disabled={locked || disabled} onChange={(e) => setMany([i.key], e.target.checked)} />
                  <span>
                    {tr(i.label)}
                    {locked && <span className="block text-xs text-muted-foreground">{tr("Wewe mwenyewe huna ruhusa hii, kwa hiyo huwezi kumpa mwingine.")}</span>}
                    {!locked && rolePermissions.includes(i.key) && <span className="block text-xs text-muted-foreground">{tr("Role yake inampa hii.")}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <DialogFooter className="sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setMany(items.map((i) => i.key), true)}>{tr("Chagua zote")}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMany(items.map((i) => i.key), false)}>{tr("Ondoa zote")}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => resetToRole(items.map((i) => i.key))}>{tr("Rudisha za role")}</Button>
            </div>
            <Button type="button" onClick={() => setOpenKey(null)}>{tr("Sawa")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
