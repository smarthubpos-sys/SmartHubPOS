import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Root cause of "Could not find public function for 'waiterDirectory:list'" in Production: the frontend (Vercel) was
 * published from a commit whose Convex functions had not been deployed (`npx convex deploy` is a separate step).
 * This test cannot see the deployment, but it guarantees the repository itself is consistent: every `api.<module>.<fn>`
 * used by the frontend is an exported query/mutation/action in convex/<module>.ts. Anything it reports must be fixed in code;
 * if it passes and Production still errors, the missing piece is a separately authorised Convex deploy.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === "_generated") return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const publicExports = (module: string): Set<string> => {
  const src = readFileSync(join("convex", `${module}.ts`), "utf8");
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*(query|mutation|action)\b/g)) names.add(m[1]);
  return names;
};

describe("frontend api.* references exist in convex/", () => {
  it("every api.<module>.<function> used in src/ is a public Convex function", () => {
    const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/\.(bak|backup)/.test(f));
    const missing: string[] = [];
    const cache = new Map<string, Set<string> | null>();
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/\bapi\.(\w+)\.(\w+)\b/g)) {
        const [, mod, fn] = m;
        if (!cache.has(mod)) {
          try { cache.set(mod, publicExports(mod)); } catch { cache.set(mod, null); }
        }
        const exp = cache.get(mod);
        if (exp === null) continue; // not a convex/<mod>.ts file (e.g. a local variable named api)
        if (exp && !exp.has(fn)) missing.push(`${f}: api.${mod}.${fn}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("the two functions reported missing in Production exist in code", () => {
    expect(publicExports("waiterDirectory").has("list")).toBe(true);
    expect(publicExports("waiterOrders").has("listForBills")).toBe(true);
  });
});
