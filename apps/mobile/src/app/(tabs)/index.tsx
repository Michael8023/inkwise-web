// 文献库 Tab：列表 / 搜索 / 筛选 / 批量 / 更多操作（收藏、归档、移动、标签、删除）
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Chip, Icon, Spinner, Tag, type IconName } from "@/components/ui/core";
import { EmptyState, Sheet, TopBar } from "@/components/ui/overlay";
import {
  createFolder,
  createTag,
  deletePapers,
  listFolders,
  listLibraryPapers,
  listTags,
  movePaper,
  renamePaper,
  saveReadingState,
  toggleArchive,
  toggleFavorite,
  togglePaperTag,
  updatePapers,
} from "@/lib/library";
import { currentUserId } from "@/lib/supabase";
import { humanError, toAppError } from "@/lib/errors";
import { toast } from "@/stores/toast";
import { useThemeStore } from "@/theme/ThemeProvider";
import { formatBytes, paperProgress, relativeTime, sourceName, THEMES } from "@/theme/tokens";
import type { LibraryFolder, LibraryPaper, LibraryTag } from "@/lib/types";
import { paperStatus } from "@/lib/status";

type Filter = "all" | "unread" | "reading" | "favorite" | "archived";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "unread", label: "待读" },
  { key: "reading", label: "进行中" },
  { key: "favorite", label: "收藏" },
  { key: "archived", label: "已归档" },
];

export default function LibraryScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const router = useRouter();
  const queryClient = useQueryClient();
  const inset = useSafeAreaInsets();

  const { data: papers = [], isLoading, error, refetch } = useQuery({
    queryKey: ["library", "papers"],
    queryFn: listLibraryPapers,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ["library", "folders"],
    queryFn: listFolders,
  });
  const { data: tags = [] } = useQuery({
    queryKey: ["library", "tags"],
    queryFn: listTags,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuPaper, setMenuPaper] = useState<LibraryPaper | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["library", "papers"] });
  };

  const visible = useMemo(() => {
    let list = papers.filter((p) => {
      if (filter === "archived") return Boolean(p.archived_at);
      if (p.archived_at) return false;
      if (filter === "favorite") return Boolean(p.is_favorite);
      const status = paperStatus(p);
      if (filter === "unread") return status === "unread";
      if (filter === "reading") return status === "reading";
      return true;
    });
    if (activeFolder) list = list.filter((p) => p.folder_id === activeFolder);
    if (activeTag) {
      list = list.filter((p) =>
        p.library_paper_tags?.some((x) => x.library_tags?.id === activeTag),
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.title, p.original_name, p.source_url || "", ...(p.library_paper_tags?.map((x) => x.library_tags?.name) || [])]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }, [papers, filter, query, activeFolder, activeTag]);

  const activeCount = papers.filter((p) => !p.archived_at).length;

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      invalidate();
      if (okMsg) toast(okMsg);
    } catch (err) {
      toast(humanError(toAppError(err)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitBatch = () => {
    setBatchMode(false);
    setSelected(new Set());
  };

  const batchAction = (fn: (ids: string[]) => Promise<void>, okMsg: string) => {
    void run(async () => fn(Array.from(selected)), okMsg).then(exitBatch);
  };

  const renderPaper = ({ item }: { item: LibraryPaper }) => {
    const status = paperStatus(item);
    const progress = paperProgress(
      item.library_paper_states?.reader_state?.currentPage,
      item.page_count,
    );
    const paperTags = (item.library_paper_tags || [])
      .map((x) => x.library_tags)
      .filter((x): x is LibraryTag => Boolean(x));
    return (
      <Pressable
        style={({ pressed }) => [
          styles.paperCard,
          { backgroundColor: t.paper, borderColor: t.border, opacity: pressed ? 0.9 : 1 },
        ]}
        onPress={() => {
          if (batchMode) toggleSelect(item.id);
          else router.push(`/paper/${item.id}`);
        }}
      >
        <View style={styles.paperBody}>
          <View style={styles.paperRow1}>
            {batchMode ? (
              <Pressable onPress={() => toggleSelect(item.id)} hitSlop={8} style={{ marginRight: 4 }}>
                <Icon
                  name={selected.has(item.id) ? "check-circle" : "radio-button-unchecked"}
                  size={20}
                  color={selected.has(item.id) ? t.accent : t.text3}
                />
              </Pressable>
            ) : null}
            <AppText variant="body" style={styles.paperTitle} numberOfLines={2}>
              {item.title}
            </AppText>
            {!batchMode ? (
              <View style={styles.paperIcons}>
                <Pressable
                  hitSlop={8}
                  onPress={() => run(() => toggleFavorite(item), item.is_favorite ? "已取消收藏" : "已收藏")}
                >
                  <Icon
                    name={item.is_favorite ? "star" : "star-outline"}
                    size={18}
                    color={item.is_favorite ? t.cite : t.text3}
                  />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setMenuPaper(item)}>
                  <Icon name="more-vert" size={18} color={t.text3} />
                </Pressable>
              </View>
            ) : null}
          </View>
          <AppText variant="small" style={{ marginTop: 3 }}>
            {sourceName(item.source_url)} · {item.page_count || "—"} 页 ·{" "}
            {formatBytes(item.file_size)}
          </AppText>
          <View style={styles.paperRow3}>
            {paperTags.slice(0, 3).map((tag) => (
              <Tag key={tag.id} style={{ marginRight: 6 }}>
                {tag.name}
              </Tag>
            ))}
            <AppText variant="caption" style={{ marginLeft: "auto" }}>
              {status === "reading"
                ? `阅读 ${progress}%`
                : status === "read"
                  ? "已读"
                  : "待读"}
              {item.last_opened_at ? ` · ${relativeTime(item.last_opened_at)}` : ""}
            </AppText>
          </View>
          {progress > 0 && progress < 100 ? (
            <View style={[styles.progressTrack, { backgroundColor: t.bg }]}>
              <View style={[styles.progressFill, { backgroundColor: t.accent, width: `${progress}%` }]} />
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar
        title="文献库"
        subtitle={`共 ${activeCount} 篇`}
        actions={
          <>
            <Pressable hitSlop={8} onPress={() => { setBatchMode((v) => !v); setSelected(new Set()); }}>
              <Icon name="checklist" size={21} color={batchMode ? t.accent : t.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setSearchOpen((v) => !v)}>
              <Icon name="search" size={21} color={t.text} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => router.push("/import")}>
              <Icon name="add" size={24} color={t.accent} />
            </Pressable>
          </>
        }
      />
      {searchOpen ? (
        <View style={[styles.searchBar, { backgroundColor: t.paper, borderColor: t.border }]}>
          <Icon name="search" size={17} color={t.text3} />
          <TextInput
            style={[styles.searchInput, { color: t.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="搜索标题、文件名、来源、标签…"
            placeholderTextColor={t.text3}
            autoFocus
          />
          {query ? (
            <Pressable hitSlop={8} onPress={() => setQuery("")}>
              <Icon name="close" size={16} color={t.text3} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
        <Chip label="文件夹" accent onPress={() => setOrgOpen(true)} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <Spinner size="large" />
        </View>
      ) : error ? (
        <EmptyState
          icon="cloud-off"
          title="文献库加载失败"
          subtitle={humanError(error)}
          actionLabel="重试"
          onAction={() => void refetch()}
        />
      ) : papers.length === 0 ? (
        <EmptyState
          icon="library-add"
          title="还没有文献"
          subtitle="上传 PDF 或输入 DOI / 链接，开始你的第一篇文献"
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderPaper}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <EmptyState
              icon="search-off"
              title="没有找到匹配的文献"
              subtitle="试试更换搜索词或筛选条件"
            />
          }
        />
      )}

      {batchMode && selected.size > 0 ? (
        <View style={[styles.batchBar, { backgroundColor: t.paper, borderTopColor: t.border }]}>
          <AppText variant="small">{selected.size} 项已选</AppText>
          <View style={styles.batchActs}>
            <Pressable hitSlop={8} onPress={() => batchAction((ids) => updatePapers(ids, { is_favorite: true }), "已批量收藏")}>
              <Icon name="star" size={19} color={t.text2} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => batchAction((ids) => updatePapers(ids, { archived_at: new Date().toISOString() }), "已批量归档")}>
              <Icon name="archive" size={19} color={t.text2} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() =>
                batchAction(async (ids) => {
                  await deletePapers(ids);
                }, "已批量删除")
              }
            >
              <Icon name="delete" size={19} color={t.danger} />
            </Pressable>
            <Pressable hitSlop={8} onPress={exitBatch}>
              <Icon name="close" size={19} color={t.text2} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 更多操作弹层 */}
      <PaperMenuSheet
        paper={menuPaper}
        folders={folders}
        tags={tags}
        onClose={() => setMenuPaper(null)}
        onRun={run}
        onPaperTags={async (paper, tag) => {
          await togglePaperTag(paper.id, tag.id);
          invalidate();
        }}
      />

      {/* 文件夹 / 标签组织弹层 */}
      <OrgSheet
        visible={orgOpen}
        onClose={() => setOrgOpen(false)}
        folders={folders}
        tags={tags}
        activeFolder={activeFolder}
        activeTag={activeTag}
        onFolder={(id) => {
          setActiveFolder(activeFolder === id ? null : id);
          setOrgOpen(false);
        }}
        onTag={(id) => {
          setActiveTag(activeTag === id ? null : id);
          setOrgOpen(false);
        }}
        onCreateFolder={async (name) => {
          const uid = await currentUserId();
          await run(() => createFolder(name, null, uid), "文件夹已创建");
        }}
        onCreateTag={async (name) => {
          const uid = await currentUserId();
          await run(() => createTag(name, uid), "标签已创建");
        }}
      />
      <View style={{ height: inset.bottom }} />
    </View>
  );
}

async function markPaperStatus(paper: LibraryPaper, read: boolean) {
  const readerState = paper.library_paper_states?.reader_state || {};
  await saveReadingState(
    paper.id,
    read
      ? { ...readerState, currentPage: paper.page_count || readerState.currentPage || 1, markedRead: true }
      : { ...readerState, currentPage: 0, markedRead: false },
    null,
    new Date().toISOString(),
  );
}

/* ---------- 更多操作弹层 ---------- */
function PaperMenuSheet({
  paper,
  folders,
  tags,
  onClose,
  onRun,
  onPaperTags,
}: {
  paper: LibraryPaper | null;
  folders: LibraryFolder[];
  tags: LibraryTag[];
  onClose: () => void;
  onRun: (fn: () => Promise<unknown>, okMsg?: string) => void;
  onPaperTags: (paper: LibraryPaper, tag: LibraryTag) => Promise<void>;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  if (!paper) return null;
  const paperTags = new Set(
    (paper.library_paper_tags || []).map((x) => x.library_tags?.id).filter(Boolean),
  );

  return (
    <Sheet visible={Boolean(paper)} onClose={onClose} title={paper.title.slice(0, 26)}>
      <MenuRow
        icon="visibility"
        label="标记为待读"
        onPress={() => {
          onRun(() => markPaperStatus(paper, false), "已标记为待读");
          onClose();
        }}
      />
      <MenuRow
        icon="task-alt"
        label="标记为已读"
        onPress={() => {
          onRun(() => markPaperStatus(paper, true), "已标记为已读");
          onClose();
        }}
      />
      <MenuRow
        icon="edit"
        label="编辑标题"
        onPress={() => {
          setRenameValue(paper.title);
          setRenameOpen(true);
        }}
      />
      <MenuRow
        icon="folder"
        label="移动到文件夹"
        onPress={onClose}
        right={
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 }}>
            <Chip
              label="未分类"
              active={!paper.folder_id}
              onPress={() => {
                onRun(() => movePaper(paper.id, null), "已移动");
                onClose();
              }}
            />
            {folders.map((f) => (
              <Chip
                key={f.id}
                label={f.name}
                active={paper.folder_id === f.id}
                onPress={() => {
                  onRun(() => movePaper(paper.id, f.id), `已移动到 ${f.name}`);
                  onClose();
                }}
              />
            ))}
          </View>
        }
      />
      <View style={{ marginTop: 6 }}>
        <AppText variant="label" style={{ marginBottom: 6 }}>标签</AppText>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {tags.length === 0 ? (
            <AppText variant="caption">暂无标签，可在「文件夹」面板创建</AppText>
          ) : (
            tags.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.name}
                active={paperTags.has(tag.id)}
                onPress={() => void onPaperTags(paper, tag)}
              />
            ))
          )}
        </View>
      </View>
      <MenuRow
        icon="archive"
        label={paper.archived_at ? "取消归档" : "归档"}
        onPress={() => {
          onRun(() => toggleArchive(paper), paper.archived_at ? "已取消归档" : "已归档");
          onClose();
        }}
      />
      <MenuRow
        icon="delete"
        label="永久删除"
        danger
        onPress={() => {
          onRun(async () => deletePapers([paper.id]), "已删除该文献");
          onClose();
        }}
      />
      {renameOpen ? (
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            style={[styles.input, { backgroundColor: t.bg, borderColor: t.border, color: t.text }]}
            placeholder="输入新标题"
            placeholderTextColor={t.text3}
          />
          <Button
            title="保存"
            style={{ marginTop: 8 }}
            onPress={() => {
              void onRun(() => renamePaper(paper.id, renameValue.trim()), "标题已更新");
              setRenameOpen(false);
              onClose();
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  danger,
  right,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        { borderBottomColor: t.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={18} color={danger ? t.danger : t.text2} />
      <AppText variant="body" color={danger ? t.danger : undefined} style={{ flex: 1 }}>
        {label}
      </AppText>
      {right}
    </Pressable>
  );
}

/* ---------- 文件夹 / 标签组织弹层 ---------- */
function OrgSheet({
  visible,
  onClose,
  folders,
  tags,
  activeFolder,
  activeTag,
  onFolder,
  onTag,
  onCreateFolder,
  onCreateTag,
}: {
  visible: boolean;
  onClose: () => void;
  folders: LibraryFolder[];
  tags: LibraryTag[];
  activeFolder: string | null;
  activeTag: string | null;
  onFolder: (id: string | null) => void;
  onTag: (id: string | null) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"folder" | "tag" | null>(null);

  const submit = () => {
    const value = name.trim();
    if (!value) return;
    if (kind === "folder") void onCreateFolder(value);
    else if (kind === "tag") void onCreateTag(value);
    setName("");
    setKind(null);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="组织文献">
      <AppText variant="label" style={{ marginBottom: 6 }}>文件夹</AppText>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <Chip label="全部" active={activeFolder === null} onPress={() => onFolder(null)} />
        {folders.map((f) => (
          <Chip key={f.id} label={f.name} active={activeFolder === f.id} onPress={() => onFolder(f.id)} />
        ))}
        <Pressable
          onPress={() => setKind(kind === "folder" ? null : "folder")}
          style={[styles.addChip, { borderColor: t.accent }]}
        >
          <Icon name="add" size={15} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 12 }}>新建</Text>
        </Pressable>
      </View>
      {kind === "folder" ? (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="文件夹名称"
            placeholderTextColor={t.text3}
            style={[styles.input, { flex: 1, backgroundColor: t.bg, borderColor: t.border, color: t.text }]}
            onSubmitEditing={submit}
          />
          <Button title="添加" onPress={submit} />
        </View>
      ) : null}

      <AppText variant="label" style={{ marginBottom: 6 }}>标签</AppText>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Chip label="全部" active={activeTag === null} onPress={() => onTag(null)} />
        {tags.map((tag) => (
          <Chip key={tag.id} label={tag.name} active={activeTag === tag.id} onPress={() => onTag(tag.id)} />
        ))}
        <Pressable
          onPress={() => setKind(kind === "tag" ? null : "tag")}
          style={[styles.addChip, { borderColor: t.accent }]}
        >
          <Icon name="add" size={15} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 12 }}>新建</Text>
        </Pressable>
      </View>
      {kind === "tag" ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="标签名称"
            placeholderTextColor={t.text3}
            style={[styles.input, { flex: 1, backgroundColor: t.bg, borderColor: t.border, color: t.text }]}
            onSubmitEditing={submit}
          />
          <Button title="添加" onPress={submit} />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexWrap: "wrap",
  },
  paperCard: {
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 10,
  },
  paperBody: {},
  paperRow1: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  paperTitle: { flex: 1, fontWeight: "500", lineHeight: 20 },
  paperIcons: { flexDirection: "row", gap: 14, marginLeft: 8 },
  paperRow3: { flexDirection: "row", alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  batchBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 70,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  batchActs: { flexDirection: "row", gap: 22 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  input: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 0.5,
    fontSize: 14,
  },
  addChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 0.5,
  },
});
