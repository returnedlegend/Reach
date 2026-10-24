/** Safe, non-sensitive release switches passed from the server to the UI. */
export type PublicFeatures = {
  accounts: boolean;
  google: boolean;
  email: boolean;
  community: boolean;
  volunteering: boolean;
  ai: boolean;
};
export const CORE_FEATURES: PublicFeatures = {
  accounts: false,
  google: false,
  email: false,
  community: false,
  volunteering: false,
  ai: false,
};
