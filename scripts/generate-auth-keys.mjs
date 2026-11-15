// Makes a NEW sign-in key pair for Convex Auth. Prints two lines: JWT_PRIVATE_KEY and JWKS.
// Paste them into the Convex dashboard (Settings > Environment Variables) of EACH deployment. Never save them in the project folder or in Git.
//   node scripts/generate-auth-keys.mjs
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
process.stdout.write(`JWT_PRIVATE_KEY=${privateKey.trimEnd().replace(/\n/g, " ")}\n`);
process.stdout.write(`JWKS=${jwks}\n`);
