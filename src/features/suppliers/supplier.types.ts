export interface SupplierInput {
  name: string;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  productTypes?: string | null;
  orderDays?: string | null;
  deliveryDays?: string | null;
  workingHours?: string | null;
  paymentTerms?: string | null;
  generalInformation?: string | null;
}

export type SupplierUpdate = Partial<SupplierInput>;

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  productTypes: string | null;
  orderDays: string | null;
  deliveryDays: string | null;
  workingHours: string | null;
  paymentTerms: string | null;
  generalInformation: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}
