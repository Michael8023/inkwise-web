// Supabase 生产后端域类型 —— 与 apps/extension/src/library.tsx 及 Edge Functions 契约对齐。

export interface LibraryFolder {
  id: string;
  parent_id: string | null;
  name: string;
  created_at?: string;
}

export interface LibraryTag {
  id: string;
  name: string;
  color: string;
}

export interface PaperTagLink {
  library_tags: LibraryTag | null;
}

export interface PaperState {
  reader_state?: ReaderState | null;
  layout_result?: Record<string, unknown> | null;
}

export interface ReaderState {
  currentPage?: number;
  scale?: number;
  notes?: { content: string; time: string; type: "user" | "ai" }[];
  [key: string]: unknown;
}

export interface LibraryPaper {
  id: string;
  folder_id: string | null;
  title: string;
  original_name: string;
  source_url: string | null;
  storage_path: string;
  file_size: number;
  page_count: number | null;
  document_text?: string | null;
  archived_at: string | null;
  is_favorite?: boolean;
  last_opened_at: string;
  created_at: string;
  library_paper_states?: PaperState | null;
  library_paper_tags?: PaperTagLink[] | null;
}

export interface PaperSummary {
  kind: "short" | "full";
  content: string;
  model?: string | null;
  document_version?: string | null;
  updated_at?: string;
}

export interface ResearchProfile {
  user_id: string;
  overview: string;
  updated_at?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  creditMultiplier: number;
  features: string[];
  available: boolean;
  tier: "free" | "pro";
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string;
  isPro: boolean;
}

export interface UsageEntry {
  feature: string;
  model: string;
  credits: number;
  status: string;
  created_at: string;
}

export interface UsageResponse {
  plan: string;
  creditsRemaining: number;
  periodEnd: string | null;
  aiPptFreeRemaining: number;
  aiPptTrialUsed: boolean;
  recentUsage: UsageEntry[];
}

export interface UserProfile {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  invite_code?: string;
}

export interface ExtractResult {
  text: string;
  contentHash: string;
  pageCount: number;
}

export interface PaperImportPayload {
  title: string;
  original_name: string;
  source_url: string | null;
  storage_path: string;
  content_hash: string;
  file_size: number;
  page_count: number | null;
  document_text: string | null;
}
