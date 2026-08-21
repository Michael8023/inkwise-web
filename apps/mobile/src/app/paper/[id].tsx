// 论文详情：摘要 / 笔记 / PDF 三个 Tab（原型 detail 屏幕，MVP 不含对话 Tab）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppText, Button, Icon, Spinner, Tag } from "@/components/ui/core";
import { Sheet, TopBar } from "@/components/ui/overlay";
import { PdfReaderWebView, type PdfReaderHandle } from "@/components/pdf/PdfReaderWebView";
import { generatePaperSummary, getDefaultModel } from "@/lib/ai";
import { humanError, toAppError } from "@/lib/errors";
import {
  createSignedPdfUrl,
  deletePapers,
  listLibraryPapers,
  listPaperSummaries,
  loadPaperState,
  saveReadingState,
  toggleArchive,
  toggleFavorite,
  touchPaperOpen,
} from "@/lib/library";
import type { LibraryPaper } from "@/lib/types";
import { toast } from "@/stores/toast";
import { useThemeStore } from "@/theme/ThemeProvider";
import { formatBytes, paperProgress, sourceName, THEMES } from "@/theme/tokens";

type DetailTab = "summary" | "notes" | "pdf";

interface NoteItem {
  content: string;
  time: string;
  type: "user" | "ai";
}

function fetchPdfDataUrl(signedUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch(signedUrl)
      .then((res) => {
        if (!res.ok) throw new Error("STORAGE_DOWNLOAD_FAILED");
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("STORAGE_DOWNLOAD_FAILED"));
        reader.readAsDataURL(blob);
      })
      .catch(reject);
  });
}

export default function PaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paperId = String(id || "");
  const router = useRouter();
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const queryClient = useQueryClient();

  const { data: papers = [] } = useQuery({
    queryKey: ["library", "papers"],
    queryFn: listLibraryPapers,
  });
  const paper = useMemo(() => papers.find((p) => p.id === paperId) || null, [papers, paperId]);

  const { data: state } = useQuery({
    queryKey: ["library", "paper-state", paperId],
    queryFn: () => loadPaperState(paperId),
    enabled: Boolean(paperId),
  });
  const { data: summaries = [] } = useQuery({
    queryKey: ["library", "paper-summaries", paperId],
    queryFn: () => listPaperSummaries(paperId),
    enabled: Boolean(paperId),
  });

  const [tab, setTab] = useState<DetailTab>("summary");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const pdfHandleRef = useRef<PdfReaderHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPage = useRef(0);

  /* 摘要流式生成 */
  const [generating, setGenerating] = useState<"short" | "full" | null>(null);
  const [streamText, setStreamText] = useState("");
  const [summaryError, setSummaryError] = useState("");

  /* 笔记 */
  const [noteDraft, setNoteDraft] = useState("");
  const notes: NoteItem[] = useMemo(() => {
    const raw = (state?.reader_state?.notes as NoteItem[] | undefined) || [];
    return raw;
  }, [state]);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["library", "papers"] });
    void queryClient.invalidateQueries({ queryKey: ["library", "paper-state", paperId] });
    void queryClient.invalidateQueries({ queryKey: ["library", "paper-summaries", paperId] });
  };

  /* ---------- PDF 加载与进度同步 ---------- */
  const pdfLoadedRef = useRef<string | null>(null);
  const loadPdf = useCallback(async () => {
    if (!paper) return;
    if (pdfLoadedRef.current === paper.id) return; // 已加载过，避免列表刷新导致重复下载
    try {
      const signedUrl = await createSignedPdfUrl(paper.storage_path, 600);
      const dataUrl = await fetchPdfDataUrl(signedUrl);
      pdfLoadedRef.current = paper.id;
      setPdfDataUrl(dataUrl);
      void touchPaperOpen(paper.id);
    } catch (err) {
      toast(humanError(toAppError(err)));
    }
  }, [paper]);

  useEffect(() => {
    if (tab === "pdf") void loadPdf();
  }, [tab, loadPdf]);

  const onPdfPageChange = (page: number, numPages: number) => {
    if (!paper || page === lastSavedPage.current) return;
    lastSavedPage.current = page;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // 合并写入：保留 notes / markedRead 等已有字段，避免覆盖
      const merged = {
        ...(state?.reader_state || {}),
        currentPage: page,
        scale: pdfHandleRef.current?.currentScale ?? 1.25,
      };
      void saveReadingState(
        paper.id,
        merged,
        state?.layout_result ?? null,
        new Date().toISOString(),
      );
      void touchPaperOpen(paper.id);
      void queryClient.invalidateQueries({ queryKey: ["library", "paper-state", paperId] });
    }, 600);
    if (numPages > 0) setPdfNumPages(numPages);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /* ---------- 摘要生成 ---------- */
  const streamRef = useRef("");
  const generateSummary = async (kind: "short" | "full") => {
    if (!paper?.document_text || generating) return;
    const model = await getDefaultModel();
    if (!model) {
      toast("模型暂不可用，请稍后再试");
      return;
    }
    streamRef.current = "";
    setStreamText("");
    setSummaryError("");
    setGenerating(kind);
    generatePaperSummary(kind, paper.document_text, model, {
      onDelta: (delta) => {
        streamRef.current += delta;
        setStreamText(streamRef.current);
      },
      onError: (message) => {
        setSummaryError(humanError(toAppError(new Error(message))));
        setGenerating(null);
      },
      onDone: () => {
        const content = streamRef.current.trim();
        setGenerating(null);
        if (!content) return;
        void (async () => {
          try {
            const { savePaperSummary } = await import("@/lib/library");
            await savePaperSummary(paper.id, kind, content);
            invalidateAll();
            toast("摘要已保存");
          } catch {
            toast("摘要已生成，但保存失败");
          }
        })();
      },
    });
  };

  /* ---------- 笔记 ---------- */
  const saveNotes = async (next: NoteItem[]) => {
    if (!paper) return;
    await saveReadingState(
      paper.id,
      { ...(state?.reader_state || {}), notes: next },
      state?.layout_result ?? null,
      new Date().toISOString(),
    );
    void queryClient.invalidateQueries({ queryKey: ["library", "paper-state", paperId] });
  };

  const addNote = async () => {
    const content = noteDraft.trim();
    if (!content || !paper) return;
    const item: NoteItem = { content, time: new Date().toISOString(), type: "user" };
    await saveNotes([item, ...notes]);
    setNoteDraft("");
    toast("笔记已保存");
  };

  const deleteNote = async (index: number) => {
    await saveNotes(notes.filter((_, i) => i !== index));
    toast("笔记已删除");
  };

  if (!paper) {
    return (
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <TopBar title="论文详情" onBack={() => router.back()} />
        <View style={styles.center}>
          <Spinner size="large" />
        </View>
      </View>
    );
  }

  const progress = paperProgress(
    state?.reader_state?.currentPage,
    paper.page_count,
  );
  const shortSummary = summaries.find((s) => s.kind === "short");
  const fullSummary = summaries.find((s) => s.kind === "full");
  const paperTags = (paper.library_paper_tags || [])
    .map((x) => x.library_tags)
    .filter(Boolean) as { id: string; name: string; color: string }[];

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar
        title="论文详情"
        subtitle={paper.page_count ? `${paper.page_count} 页 · ${formatBytes(paper.file_size)}` : undefined}
        onBack={() => router.back()}
        actions={
          <>
            <Pressable
              hitSlop={8}
              onPress={() => {
                void (async () => {
                  try {
                    await toggleFavorite(paper);
                    invalidateAll();
                    toast(paper.is_favorite ? "已取消收藏" : "已收藏");
                  } catch (err) {
                    toast(humanError(toAppError(err)));
                  }
                })();
              }}
            >
              <Icon name={paper.is_favorite ? "star" : "star-outline"} size={20} color={paper.is_favorite ? t.cite : t.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setMenuOpen(true)}>
              <Icon name="more-vert" size={20} color={t.text} />
            </Pressable>
          </>
        }
      />

      <View style={[styles.meta, { borderBottomColor: t.border }]}>
        <AppText variant="title" numberOfLines={3}>{paper.title}</AppText>
        <AppText variant="small" style={{ marginTop: 6 }}>
          {sourceName(paper.source_url)} · 最近阅读{" "}
          {paper.last_opened_at ? new Date(paper.last_opened_at).toLocaleDateString("zh-CN") : "—"}
          {progress > 0 ? ` · 进度 ${progress}%` : ""}
        </AppText>
        {paperTags.length > 0 ? (
          <View style={styles.tagRow}>
            {paperTags.map((tag) => (
              <Tag key={tag.id} style={{ marginRight: 6 }}>{tag.name}</Tag>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.tabbar, { backgroundColor: t.paper, borderColor: t.border }]}>
        {(["summary", "notes", "pdf"] as DetailTab[]).map((key) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.tabItem}>
            <Text
              style={[
                styles.tabLabel,
                { color: tab === key ? t.primary : t.text2 },
                tab === key && { borderBottomColor: t.accent, fontWeight: "500" },
              ]}
            >
              {key === "summary" ? "摘要" : key === "notes" ? "笔记" : "PDF"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "summary" ? (
          <ScrollView contentContainerStyle={styles.pane} style={{ flex: 1 }}>
            {shortSummary || fullSummary ? (
              <>
                <SummaryCard label="一句话摘要" content={shortSummary?.content || ""} />
                {fullSummary ? (
                  <>
                    <View style={{ height: 10 }} />
                    <SummaryCard label="完整摘要" content={fullSummary.content} />
                  </>
                ) : null}
                {!fullSummary && paper?.document_text ? (
                  <Button
                    title="生成完整摘要"
                    variant="outline"
                    loading={generating === "full"}
                    style={{ marginTop: 12 }}
                    onPress={() => generateSummary("full")}
                  />
                ) : null}
              </>
            ) : generating ? (
              <>
                <View style={styles.infoCard}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Spinner size="small" />
                    <AppText variant="small">正在生成摘要…</AppText>
                  </View>
                  <AppText variant="body" style={{ marginTop: 10, lineHeight: 20 }}>
                    {streamText || "正在分析文档内容"}
                  </AppText>
                </View>
              </>
            ) : paper?.document_text ? (
              <>
                <View style={styles.infoCard}>
                  <AppText variant="small" style={{ textAlign: "center", color: t.text3 }}>
                    这篇文献还没有摘要
                  </AppText>
                </View>
                <Button
                  title="生成一句话摘要"
                  style={{ marginTop: 12 }}
                  onPress={() => generateSummary("short")}
                />
                <Button
                  title="生成完整摘要"
                  variant="outline"
                  style={{ marginTop: 10 }}
                  onPress={() => generateSummary("full")}
                />
              </>
            ) : (
              <View style={styles.infoCard}>
                <AppText variant="small" style={{ textAlign: "center", color: t.text3 }}>
                  该文献暂无文本内容，AI 摘要暂不可用
                </AppText>
              </View>
            )}
            {summaryError ? (
              <AppText variant="small" color={t.danger} style={{ marginTop: 10, textAlign: "center" }}>
                {summaryError}
              </AppText>
            ) : null}
          </ScrollView>
        ) : null}

        {tab === "notes" ? (
          <ScrollView contentContainerStyle={styles.pane} style={{ flex: 1 }}>
            <View style={styles.noteAdd}>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="添加笔记…"
                placeholderTextColor={t.text3}
                multiline
                style={[styles.noteInput, { backgroundColor: t.paper, borderColor: t.border, color: t.text }]}
              />
              <Button title="保存" onPress={() => void addNote()} />
            </View>
            {notes.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: "center" }}>
                <Icon name="sticky-note-2" size={36} color={t.text3} />
                <AppText variant="small" style={{ marginTop: 10 }}>
                  还没有笔记，写下你的想法
                </AppText>
              </View>
            ) : (
              notes.map((note, i) => (
                <View key={`${note.time}-${i}`} style={[styles.noteItem, { backgroundColor: t.paper, borderColor: t.border }]}>
                  <View style={styles.noteHead}>
                    <Tag color={note.type === "user" ? t.accent : t.primary}>
                      {note.type === "user" ? "我的笔记" : "AI 回答"}
                    </Tag>
                    <AppText variant="caption">
                      {new Date(note.time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </AppText>
                    <Pressable hitSlop={8} style={{ marginLeft: "auto" }} onPress={() => void deleteNote(i)}>
                      <Icon name="close" size={15} color={t.text3} />
                    </Pressable>
                  </View>
                  <AppText variant="body" style={{ marginTop: 6 }}>{note.content}</AppText>
                </View>
              ))
            )}
          </ScrollView>
        ) : null}

        {tab === "pdf" ? (
          <View style={{ flex: 1 }}>
            <PdfReaderWebView
              dataUrl={pdfDataUrl}
              initialPage={state?.reader_state?.currentPage || 1}
              handleRef={pdfHandleRef}
              onReady={(numPages) => setPdfNumPages(numPages)}
              onPageChange={onPdfPageChange}
              onError={(message) => toast(message)}
            />
            <View style={[styles.pdfNav, { backgroundColor: t.paper, borderTopColor: t.border }]}>
              <Pressable hitSlop={8} onPress={() => pdfHandleRef.current?.gotoPage(Math.max(1, (state?.reader_state?.currentPage || 1) - 1))}>
                <Icon name="chevron-left" size={22} color={t.text2} />
              </Pressable>
              <AppText variant="small">
                第 {state?.reader_state?.currentPage || 1} 页 / 共 {pdfNumPages || paper.page_count || "—"} 页
              </AppText>
              <Pressable hitSlop={8} onPress={() => pdfHandleRef.current?.gotoPage(Math.min(pdfNumPages || 999, (state?.reader_state?.currentPage || 1) + 1))}>
                <Icon name="chevron-right" size={22} color={t.text2} />
              </Pressable>
              <View style={{ width: 1, height: 18, backgroundColor: t.border }} />
              <Pressable hitSlop={8} onPress={() => pdfHandleRef.current?.zoomBy(-0.15)}>
                <Icon name="zoom-out" size={20} color={t.text2} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => pdfHandleRef.current?.zoomBy(0.15)}>
                <Icon name="zoom-in" size={20} color={t.text2} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {/* 更多操作 */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="文献操作">
        <Pressable
          style={[styles.menuRow, { borderBottomColor: t.border }]}
          onPress={() => {
            void (async () => {
              try {
                await toggleArchive(paper);
                invalidateAll();
                toast(paper.archived_at ? "已取消归档" : "已归档");
                setMenuOpen(false);
              } catch (err) {
                toast(humanError(toAppError(err)));
              }
            })();
          }}
        >
          <Icon name="archive" size={18} color={t.text2} />
          <AppText variant="body" style={{ marginLeft: 10 }}>{paper.archived_at ? "取消归档" : "归档"}</AppText>
        </Pressable>
        <Pressable
          style={styles.menuRow}
          onPress={() => {
            void (async () => {
              try {
                await deletePapers([paper.id]);
                toast("已删除该文献");
                router.back();
              } catch (err) {
                toast(humanError(toAppError(err)));
              }
            })();
          }}
        >
          <Icon name="delete" size={18} color={t.danger} />
          <AppText variant="body" color={t.danger} style={{ marginLeft: 10 }}>永久删除</AppText>
        </Pressable>
      </Sheet>
    </View>
  );
}

function SummaryCard({ label, content }: { label: string; content: string }) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={[styles.infoCard, { backgroundColor: t.paper, borderColor: t.border }]}>
      <AppText variant="label" color={t.accent} style={{ marginBottom: 6 }}>{label}</AppText>
      <AppText variant="body">{content}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  meta: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  tagRow: { flexDirection: "row", marginTop: 8, flexWrap: "wrap" },
  tabbar: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 11 },
  tabLabel: {
    fontSize: 14,
    paddingBottom: 2,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  pane: { padding: 16, paddingBottom: 32 },
  infoCard: {
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 14,
  },
  noteAdd: { flexDirection: "row", gap: 8, marginBottom: 14, alignItems: "flex-end" },
  noteInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    borderRadius: 8,
    borderWidth: 0.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  noteItem: {
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 12,
    marginBottom: 10,
  },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  pdfNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 0.5,
  },
});
