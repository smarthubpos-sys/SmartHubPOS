import { createContext } from "react";
import type { User } from "oidc-client-ts";

export type AuthValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  signin: () => Promise<void>;
  signout: () => Promise<void>;
  completeSignIn: () => Promise<void>;
};

export const AuthContext = createContext<AuthValue | null>(null);
