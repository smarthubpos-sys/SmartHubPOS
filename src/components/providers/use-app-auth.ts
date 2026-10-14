import { useContext } from "react";
import { AuthContext } from "./auth-context.ts";

export function useAppAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAppAuth must be used inside AuthProvider");
  return value;
}
