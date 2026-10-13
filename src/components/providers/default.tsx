import { ConvexProvider } from "./convex.tsx";
import { QueryClientProvider } from "./query-client.tsx";
import { ThemeProvider } from "./theme.tsx";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
function AuthSync(){const {isAuthenticated}=useConvexAuth();const sync=useMutation(api.users.updateCurrentUser);useEffect(()=>{if(isAuthenticated)sync().catch((e)=>console.error("User sync failed",e));},[isAuthenticated,sync]);return null;}

export function DefaultProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider>
      <QueryClientProvider>
        <AuthSync />
        <TooltipProvider>
          <ThemeProvider>
            <Toaster />
            {children}
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ConvexProvider>
  );
}
