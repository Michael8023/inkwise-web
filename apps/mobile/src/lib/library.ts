// 文献库数据访问 —— select 字段与网页端 apps/extension/src/library.tsx 完全一致。
import { File } from "expo-file-system";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { uuid } from "./uuid";
import type {
  LibraryFolder,
  LibraryPaper,
  LibraryTag,
  PaperImportPayload,
  PaperSummary,
  ReaderState,
} from "./types";

const PAPER_SELECT =
  "id, folder_id, title, original_name, source_url, storage_path, file_size, page_count, archived_at, last_opened_at, created_at, is_favorite, library_paper_states(reader_state), library_paper_tags(library_tags(id,name,color))";

export async function listLibraryPapers(): Promise<LibraryPaper[]> {
  const { data, error } = await supabase
    .from("library_papers")
    .select(PAPER_SELECT)
    .order("last_opened_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as unknown as LibraryPaper[];
}

export async function listFolders(): Promise<LibraryFolder[]> {
  const { data, error } = await supabase
    .from("library_folders")
    .select("id,parent_id,name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data || []) as LibraryFolder[];
}

export async function listTags(): Promise<LibraryTag[]> {
  const { data, error } = await supabase
    .from("library_tags")
    .select("id,name,color")
    .order("name");
  if (error) throw new Error(error.message);
  return (data || []) as LibraryTag[];
}

export async function loadPaperState(paperId: string): Promise<{ reader_state?: ReaderState; layout_result?: Record<string, unknown> } | null> {
  const { data, error } = await supabase
    .from("library_paper_states")
    .select("reader_state, layout_result")
    .eq("paper_id", paperId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { reader_state?: ReaderState; layout_result?: Record<string, unknown> } | null;
}

export async function updatePapers(ids: string[], values: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("library_papers").update(values).in("id", ids);
  if (error) throw new Error(error.message);
}

export async function toggleFavorite(paper: LibraryPaper): Promise<void> {
  await updatePapers([paper.id], { is_favorite: !paper.is_favorite });
}

export async function toggleArchive(paper: LibraryPaper): Promise<void> {
  await updatePapers([paper.id], {
    archived_at: paper.archived_at ? null : new Date().toISOString(),
  });
}

export async function renamePaper(paperId: string, title: string): Promise<void> {
  await updatePapers([paperId], { title: title.slice(0, 500) });
}

export async function movePaper(paperId: string, folderId: string | null): Promise<void> {
  await updatePapers([paperId], { folder_id: folderId });
}

export async function deletePapers(paperIds: string[]): Promise<void> {
  const { data: papers, error: listError } = await supabase
    .from("library_papers")
    .select("storage_path")
    .in("id", paperIds);
  if (listError) throw new Error(listError.message);
  const { error: deleteError } = await supabase
    .from("library_papers")
    .delete()
    .in("id", paperIds);
  if (deleteError) throw new Error(deleteError.message);
  if (papers?.length) {
    const storage = await supabase.storage
      .from("library-pdfs")
      .remove(papers.map((p) => p.storage_path));
    if (storage.error) throw new Error(storage.error.message);
  }
}

export async function createFolder(name: string, parentId: string | null, userId: string): Promise<void> {
  const { error } = await supabase.from("library_folders").insert({
    name: name.slice(0, 120),
    parent_id: parentId,
    user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("library_folders").update({ name: name.slice(0, 120) }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from("library_folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createTag(name: string, userId: string): Promise<void> {
  const { error } = await supabase.from("library_tags").insert({
    name: name.slice(0, 48),
    color: "#0e9f9a",
    user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function renameTag(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("library_tags").update({ name: name.slice(0, 48) }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTag(id: string): Promise<void> {
  const { error } = await supabase.from("library_tags").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function togglePaperTag(paperId: string, tagId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("library_paper_tags")
    .select("paper_id")
    .eq("paper_id", paperId)
    .eq("tag_id", tagId)
    .maybeSingle();
  const result = existing
    ? await supabase.from("library_paper_tags").delete().eq("paper_id", paperId).eq("tag_id", tagId)
    : await supabase.from("library_paper_tags").insert({ paper_id: paperId, tag_id: tagId });
  if (result.error) throw new Error(result.error.message);
}

/** 上传本地 PDF 到私有桶；返回 storage_path。路径规则与网页端一致：{userId}/{uuid}.pdf
 *  RN 上传必须传字节（storage-js 对 Blob/FormData 在 RN 下不可用，文档推荐 ArrayBuffer） */
export async function uploadPdf(uri: string, name: string, mime: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  let bytes: Uint8Array;
  if (Platform.OS === "web") {
    // Web 预览：文档选择器返回 blob:/data: URI，用 fetch 读取字节
    const response = await fetch(uri);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    bytes = new File(uri).bytesSync();
  }
  if (bytes.byteLength === 0) throw new Error("INVALID_PDF_FILE");
  const storagePath = `${user.id}/${uuid()}.pdf`;
  const { error } = await supabase.storage
    .from("library-pdfs")
    .upload(storagePath, bytes, { contentType: mime });
  if (error) throw new Error("STORAGE_UPLOAD_FAILED");
  return storagePath;
}

/** 上传内存中的 PDF 字节（DOI/URL 导入：Edge Function 返回二进制后直接上传） */
export async function uploadPdfBytes(bytes: Uint8Array, name: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  const storagePath = `${user.id}/${uuid()}.pdf`;
  const { error } = await supabase.storage
    .from("library-pdfs")
    .upload(storagePath, bytes, { contentType: "application/pdf" });
  if (error) throw new Error("STORAGE_UPLOAD_FAILED");
  return storagePath;
}

/** 删除已上传但未入库的存储对象（重复导入 / 入库失败时清理孤儿文件） */
export async function removeStorageObject(storagePath: string): Promise<void> {
  await supabase.storage.from("library-pdfs").remove([storagePath]);
}

export async function createSignedPdfUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from("library-pdfs")
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) throw new Error("STORAGE_DOWNLOAD_FAILED");
  return data.signedUrl;
}

/** 插入论文记录（content_hash 唯一冲突视为重复导入） */
export async function insertPaper(payload: PaperImportPayload): Promise<{ id: string; duplicate: boolean }> {
  const { data, error } = await supabase
    .from("library_papers")
    .insert({
      title: payload.title.slice(0, 500),
      original_name: payload.original_name,
      source_url: payload.source_url,
      storage_path: payload.storage_path,
      content_hash: payload.content_hash,
      file_size: payload.file_size,
      page_count: payload.page_count,
      document_text: payload.document_text,
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate key|23505/i.test(error.message)) {
      return { id: "", duplicate: true };
    }
    throw new Error(error.message);
  }
  return { id: data.id, duplicate: false };
}

/** 读取已保存的摘要（short/full） */
export async function listPaperSummaries(paperId: string): Promise<PaperSummary[]> {
  const { data, error } = await supabase
    .from("paper_summaries")
    .select("kind,content,model,document_version,updated_at")
    .eq("paper_id", paperId);
  if (error) throw new Error(error.message);
  return (data || []) as PaperSummary[];
}

export async function savePaperSummary(paperId: string, kind: "short" | "full", content: string): Promise<void> {
  const { error } = await supabase
    .from("paper_summaries")
    .upsert(
      { paper_id: paperId, kind, content },
      { onConflict: "paper_id,kind" },
    );
  if (error) throw new Error(error.message);
}

/** 保存阅读进度（版本化 RPC，与网页端同构，防乱序覆盖） */
export async function saveReadingState(
  paperId: string,
  readerState: Record<string, unknown>,
  layoutResult: Record<string, unknown> | null,
  updatedAt: string,
): Promise<void> {
  const { error } = await supabase.rpc("save_library_paper_state", {
    p_paper_id: paperId,
    p_reader_state: readerState,
    p_layout_result: layoutResult,
    p_updated_at: updatedAt,
  });
  if (error) throw new Error(error.message);
}

export async function touchPaperOpen(paperId: string): Promise<void> {
  const { error } = await supabase
    .from("library_papers")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", paperId);
  if (error) throw new Error(error.message);
}

export async function upsertResearchOverview(userId: string, overview: string): Promise<void> {
  const { error } = await supabase
    .from("research_profiles")
    .upsert({ user_id: userId, overview: overview.slice(0, 6000) }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function fetchResearchOverview(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("research_profiles")
    .select("overview")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.overview || "";
}

export async function submitFeedback(userId: string, category: string, content: string): Promise<void> {
  const { error } = await supabase.from("user_feedback").insert({
    user_id: userId,
    category,
    content: content.slice(0, 2000),
  });
  if (error) throw new Error(error.message);
}
