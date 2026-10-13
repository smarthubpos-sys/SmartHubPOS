declare module "oidc-client-ts" {
  export class User {
    expired?: boolean;
  }
  export class WebStorageStateStore {
    constructor(options?: { store?: Storage });
  }
  export class UserManager {
    constructor(settings: Record<string, unknown>);
    events: { addUserSignedOut(callback: () => void): void; removeUserSignedOut(callback: () => void): void };
    getUser(): Promise<User | null>;
    signinRedirect(): Promise<void>;
    signoutRedirect(): Promise<void>;
    signinRedirectCallback(): Promise<User>;
  }
}
