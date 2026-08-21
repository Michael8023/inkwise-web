import { describe, expect, it } from "vitest";
import { paperStatus } from "../status";
import type { LibraryPaper } from "../types";

function paper(overrides: Partial<LibraryPaper> = {}): LibraryPaper {
  return {
    id: "p1",
    folder_id: null,
    title: "t",
    original_name: "t.pdf",
    source_url: null,
    storage_path: "u/p.pdf",
    file_size: 1000,
    page_count: 10,
    archived_at: null,
    last_opened_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    library_paper_states: { reader_state: {} },
    library_paper_tags: [],
    ...overrides,
  };
}

describe("paperStatus", () => {
  it("无进度为待读", () => {
    expect(paperStatus(paper())).toBe("unread");
  });

  it("进行中（0 < 进度 < 100）", () => {
    expect(
      paperStatus(
        paper({ library_paper_states: { reader_state: { currentPage: 3 } } }),
      ),
    ).toBe("reading");
  });

  it("读满为已读", () => {
    expect(
      paperStatus(
        paper({ library_paper_states: { reader_state: { currentPage: 10 } } }),
      ),
    ).toBe("read");
  });

  it("markedRead 标记优先于页码（无 page_count 也能显示已读）", () => {
    expect(
      paperStatus(
        paper({
          page_count: null,
          library_paper_states: { reader_state: { currentPage: 2, markedRead: true } },
        }),
      ),
    ).toBe("read");
    expect(
      paperStatus(
        paper({
          page_count: null,
          library_paper_states: { reader_state: { currentPage: 2 } },
        }),
      ),
    ).toBe("unread");
  });
});
