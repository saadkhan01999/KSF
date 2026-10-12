/* The medicine directory, as the API returns it. */

export type Prescription = 'otc' | 'prescription' | 'controlled';

export interface DirectoryRow {
  id: string; name: string; synonyms: string[]; category: string; prescription: Prescription; forms: string[];
  brands: { name: string; manufacturer: string | null }[]; status: 'published' | 'draft' | 'archived';
  verified_at: string | null; verified_by_name: string | null; uses: string[];
}

export interface DirectoryEntry extends DirectoryRow {
  precautions: string[]; side_effects: string[]; interactions: string[];
  references: { source: string; title: string | null; url: string }[];
  prescription_label: string; source: 'starter' | 'team'; updated_at: string;
}

export interface DirectoryList {
  data: DirectoryRow[]; page: number; pages: number; total: number; size: number;
  categories: { category: string; count: number }[];
  suggested: string[];
  canManage: boolean;
}
