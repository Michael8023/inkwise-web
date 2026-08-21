// 文献阅读状态判定（纯函数，可单测）
import { paperProgress } from "@/theme/tokens";
import type { LibraryPaper } from "./types";

export type PaperStatus = "unread" | "reading" | "read";

export function paperStatus(p: LibraryPaper): PaperStatus {
  const readerState = p.library_paper_states?.reader_state;
  if (readerState?.markedRead) return "read";
  const progress = paperProgress(readerState?.currentPage, p.page_count);
  if (progress >= 100) return "read";
  if (progress > 0) return "reading";
  return "unread";
}
