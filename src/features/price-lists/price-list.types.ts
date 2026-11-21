export interface PriceListVersion {
  id: number;
  priceListId: number;
  driveFileId: string;
  filename: string;
  uploadedAt: string;
  archivedAt: string | null;
  previousVersionId: number | null;
}
