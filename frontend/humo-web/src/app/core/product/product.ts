/**
 * Brand architecture.
 *
 *   Humo                          — the product family / platform (identity, security,
 *   │                               audit, billing, subscriptions, the Humo company and staff)
 *   ├── Humo Property Management  — THIS application ("Humo PM" where space is short)
 *   ├── Humo Valuations           — future, separate product
 *   └── Humo Contractor           — future, separate product
 *
 * Keep the layers apart in copy and code:
 *   product family (Humo) ≠ application (Humo Property Management) ≠ organisation
 *   (Tshikrand) ≠ user (Sarah Jacobs) ≠ role (Portfolio Manager) ≠ scope (Oakwood Estate)
 *   ≠ package (Humo Professional) ≠ feature entitlement (Governance).
 */
export type HumoProductId = 'property-management' | 'valuations' | 'contractor';

export interface HumoProduct {
  id: HumoProductId;
  name: string;
  /** Where space is limited (tabs, tight headers). */
  shortName: string;
  purpose: string;
  status: 'active' | 'prototype' | 'future';
}

export const HUMO_FAMILY = {
  name: 'Humo',
  descriptor: 'Property technology platform',
} as const;

/** The registry a future Humo product switcher (outside each application) would read. */
export const HUMO_PRODUCTS: Record<HumoProductId, HumoProduct> = {
  'property-management': {
    id: 'property-management',
    name: 'Humo Property Management',
    shortName: 'Humo PM',
    purpose: 'Managing agents and community-scheme management.',
    status: 'active',
  },
  valuations: {
    id: 'valuations',
    name: 'Humo Valuations',
    shortName: 'Humo Valuations',
    purpose: 'Property and municipal valuation workflows.',
    status: 'future',
  },
  contractor: {
    id: 'contractor',
    name: 'Humo Contractor',
    shortName: 'Humo Contractor',
    purpose: 'Contractor profiles, quotation workflows and the contractor ecosystem.',
    // Its portal is prototyped in this codebase (/contractor) to prove the boundary; it's a separate product.
    status: 'prototype',
  },
};

/** This application. */
export const PRODUCT = HUMO_PRODUCTS['property-management'];
export const PRODUCT_TAGLINE = 'One platform. Every scheme. Everything managed.';
