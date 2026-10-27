import type { Role } from "@prisma/client";

// V1 permission matrix. Derived from main v2 BR-24 with the client decisions in
// v1/DECISIONS.md (D2: every role may record sales; D12: purchases are admin/manager only).
export const PERMISSIONS = {
  "catalog.view": ["admin", "sales_manager", "sales_staff"],
  "product.write": ["admin", "sales_manager"],
  "product.archive": ["admin"],
  "category.write": ["admin", "sales_manager"],
  "stock.adjust": ["admin", "sales_manager"],
  // V2: company-wide settings.
  "company.settings": ["admin"],
  // V2: cancel a sale / purchase with a reason (D3, plan §3.1).
  "sale.void": ["admin", "sales_manager"],
  "purchase.void": ["admin", "sales_manager"],
  // V2: edit a sale / purchase (creates a revision and cancels original).
  "sale.edit": ["admin", "sales_manager"],
  "purchase.edit": ["admin", "sales_manager"],
  // V2: supplier rate cards (plan §4). Rates are costs, so staff do not see them (audit B05).
  "vendor_pricing.view": ["admin", "sales_manager"],
  "vendor_pricing.manage": ["admin", "sales_manager"],
  // Minimum/selling price, fallback cost and low-stock threshold (main v2 Stock In, BR-08a).
  "inventory.configure": ["admin", "sales_manager"],
  "sale.create": ["admin", "sales_manager", "sales_staff"],
  "sale.view": ["admin", "sales_manager", "sales_staff"],
  "purchase.create": ["admin", "sales_manager"],
  // main v2 hides purchase orders from sales_staff (BR-24).
  "purchase.view": ["admin", "sales_manager"],
  // Any role can add a customer from the cart (main v2 allowCreate); editing is admin/manager (D20).
  "party.create": ["admin", "sales_manager", "sales_staff"],
  "party.edit": ["admin", "sales_manager"],
  "user.manage": ["admin"],
  "audit.view": ["admin"],
  "backup.manage": ["admin"],
  // V3.1 sets: opening sets (no supplier or bill) and cancelling an untouched one (D20).
  "set.opening": ["admin"],
  // V3.1 warehouses (docs\WAREHOUSE-V3-PLAN.md §1): create first / add / rename / default /
  // deactivate is admin; shifting stock and cancelling a shift is admin + manager (owner confirmed).
  "warehouse.manage": ["admin"],
  "stock.transfer": ["admin", "sales_manager"],
  "stock.transfer.void": ["admin", "sales_manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
