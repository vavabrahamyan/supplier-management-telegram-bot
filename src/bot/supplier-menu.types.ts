export type Screen = { kind: 'list'; page: number; query?: string } | { kind: 'workspace'; id: number; page: number; query?: string } | { kind: 'search' } | { kind: 'add' };
export interface Interaction { screen: Screen; token: string; messageId?: number; }
