export const PERMISSIONS = {
  EVENTS_APPROVE: 'events:approve',
  PAYOUTS_APPROVE: 'finance:payout:approve',
  USERS_MANAGE: 'users:manage',
  CONFIG_FEES_WRITE: 'config:fees:write',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export type Role = 'customer' | 'organizer' | 'admin';

// Defines the base capabilities of roles (Administrators will have granular sub-permissions managed in DB later)
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  customer: [],
  organizer: [],
  admin: [
    PERMISSIONS.EVENTS_APPROVE,
    PERMISSIONS.PAYOUTS_APPROVE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.CONFIG_FEES_WRITE,
  ],
};