import { AuthConfig } from "convex/server";

// Convex Auth issues and validates its own tokens using the deployment's site URL.
// No third-party OIDC authority or client ID is needed.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
