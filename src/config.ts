/** Build-time settings. None of these are secrets; see .env.example. */
export const config = {
  homeserverUrl: (import.meta.env.VITE_HOMESERVER_URL as string | undefined) ?? "https://matrix.kuartalsystems.com",
  ssoLabel: (import.meta.env.VITE_SSO_LABEL as string | undefined) ?? "Sign in with Kuartal ID",
  appName: "Konnect",
};
