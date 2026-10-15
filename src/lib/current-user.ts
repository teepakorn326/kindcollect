// Hard-coded current user (CLAUDE.md §1 Auth). Basic Auth gates the app; everyone acts as Sarah.
export const currentUser = {
  name: "Sarah",
  initials: "SA",
  role: "Bookkeeper",
} as const;

export const currentBusinessName = "Fresh Harvest Produce";
