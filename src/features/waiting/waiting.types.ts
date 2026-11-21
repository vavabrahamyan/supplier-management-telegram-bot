export interface WaitingItem {
  id: number;
  supplierId: number;
  text: string;
  position: number;
  createdAt: string;
  confirmedAt: string;
}
export type WaitingAction = 'received' | 'returned' | 'cancelled';
