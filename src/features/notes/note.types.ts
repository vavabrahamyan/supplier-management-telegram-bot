export interface Note { id: number; supplierId: number; text: string; revision: number; createdAt: string; updatedAt: string; completedAt: string | null }
export interface NoteVersion { id: number; revision: number }
