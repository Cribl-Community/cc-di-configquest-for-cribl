// Ambient typings for the globals the Cribl App Platform injects on `window`.
// These are read-only and always present at runtime inside Cribl (see AGENTS.md).
// We only *type* them here — never assign or polyfill them.

interface CriblUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  initials?: string;
}

/** App version, injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  /** Base URL for all Cribl API calls, e.g. `https://host:9000/api/v1`. */
  readonly CRIBL_API_URL?: string;
  /** The base path the app is mounted at, e.g. `/app-ui/my-app`. */
  readonly CRIBL_BASE_PATH?: string;
  /** The app's id (set to `__dev__<name>` under `npm run dev`). */
  readonly CRIBL_APP_ID?: string;
  /** Resolves to the currently signed-in Cribl user (memoized). */
  getCriblUser?: () => Promise<CriblUser>;
}
