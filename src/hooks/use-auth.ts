import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";

export function useAuth() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const user = useQuery(api.users.getCurrentUser);
  return {
    user: user ?? null,
    isAuthenticated,
    isLoading,
    signout: () => signOut(),
  };
}

export function useUser() {
  return useAuth().user;
}
