import type { SupplierInput } from '../features/suppliers/supplier.types.ts';
export type SupplierField = keyof SupplierInput;
type SupplierScreen = { id: number; page: number; query?: string };
export type Screen = { kind: 'list'; page: number; query?: string } | ({ kind: 'workspace' | 'information' | 'confirmArchive' } & SupplierScreen) | ({ kind: 'order'; orderPage: number; copying?: boolean } & SupplierScreen) | ({ kind: 'checklist'; checkPage: number; itemIds: number[]; selectedIds: number[] } & SupplierScreen) | ({ kind: 'waiting' | 'waitingRemove'; waitingPage: number; itemIds: number[]; selectedIds: number[] } & SupplierScreen) | ({ kind: 'orderInput'; operation: 'append' | 'replace' } & SupplierScreen) | ({ kind: 'edit'; field: SupplierField; mode?: 'intervalDays' | 'intervalWeeks' | 'customCategory'; intervalValue?: string } & SupplierScreen) | { kind: 'search' } | { kind: 'add' };
export interface Interaction { screen: Screen; token: string; messageId?: number; }
