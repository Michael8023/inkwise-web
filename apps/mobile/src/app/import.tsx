// 添加文献（modal）：上传 PDF / DOI 或链接 → 上传 → 解析（文本+哈希）→ 入库
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProgressSteps, TopBar } from "@/components/ui/overlay";
import { AppText, Button, Icon } from "@/components/ui/core";
import { extractPdfText } from "@/lib/ai";
import { edgeFetch } from "@/lib/edge";
import { humanError, toAppError } from "@/lib/errors";
import { insertPaper, removeStorageObject, uploadPdf, uploadPdfBytes } from "@/lib/library";
import { isDoiLink, normalizeUrl } from "@/lib/url";
import { toast } from "@/stores/toast";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

const MAX_BYTES = 50 * 1024 * 1024;
const STEPS = ["上传文件", "解析元数据", "保存到文献库"];

export default function ImportScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const router = useRouter();
  const inset = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"upload" | "doi">("upload");
  const [doi, setDoi] = useState("");
  const [phase, setPhase] = useState<"form" | "progress" | "done">("form");
  const [progressIdx, setProgressIdx] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"added" | "duplicate">("added");

  const invalidateLibrary = () => {
    void queryClient.invalidateQueries({ queryKey: ["library", "papers"] });
  };

  /** 完成入库：storagePath → 解析（文本+哈希）→ insert */
  const finishImport = async (
    storagePath: string,
    originalName: string,
    sourceUrl: string | null,
    fileSize: number,
  ) => {
    setPhase("progress");
    setProgressIdx(0);
    setError("");
    try {
      setProgressIdx(1);
      let text: string | null = null;
      let hash = "";
      let pageCount: number | null = null;
      try {
        const extracted = await extractPdfText(storagePath);
        text = extracted.text || null;
        hash = extracted.contentHash;
        pageCount = extracted.pageCount || null;
      } catch (parseError) {
        const code = parseError instanceof Error ? parseError.message : "";
        if (code === "TEXT_EMPTY") {
          // 扫描件：仍入库，阅读可用，AI 摘要降级
          toast("该 PDF 无文本层，AI 摘要暂不可用，阅读不受影响");
        } else {
          throw parseError;
        }
      }
      setProgressIdx(2);
      const title = originalName.replace(/\.pdf$/i, "") || "未命名文献";
      const { duplicate } = await insertPaper({
        title,
        original_name: originalName,
        source_url: sourceUrl,
        storage_path: storagePath,
        content_hash: hash,
        file_size: fileSize,
        page_count: pageCount,
        document_text: text,
      });
      if (duplicate) {
        // 重复导入：删除刚上传的存储对象，避免孤儿文件
        void removeStorageObject(storagePath).catch(() => undefined);
      }
      setResult(duplicate ? "duplicate" : "added");
      toast(duplicate ? "该文献已在文献库中" : "文献已添加");
      invalidateLibrary();
      setPhase("done");
    } catch (err) {
      // 入库失败：清理已上传的存储对象
      void removeStorageObject(storagePath).catch(() => undefined);
      setError(humanError(toAppError(err, "IMPORT_FAILED")));
      setPhase("form");
      setWorking(false);
    }
  };

  /** 本地 PDF */
  const pickAndImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.name?.toLowerCase().endsWith(".pdf") && asset.mimeType !== "application/pdf") {
        setError("请选择有效的 PDF 文件");
        return;
      }
      if (asset.size && asset.size > MAX_BYTES) {
        setError("文件超过 50MB 上限");
        return;
      }
      setWorking(true);
      const storagePath = await uploadPdf(asset.uri, asset.name || "document.pdf", asset.mimeType || "application/pdf");
      await finishImport(storagePath, asset.name || "document.pdf", null, asset.size || 1);
    } catch (err) {
      setError(humanError(toAppError(err)));
      setWorking(false);
    }
  };

  /** DOI / 链接：pdf-fetch 服务端抓取 → 二进制 → 上传 → 入库 */
  const importDoi = async () => {
    const url = normalizeUrl(doi);
    if (!url) {
      setError("请输入 DOI 或论文链接");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const isDoi = isDoiLink(url);
      const response = await edgeFetch("pdf-fetch", {
        method: "POST",
        body: JSON.stringify({ url, resolveDoi: isDoi }),
      });
      if (!response.ok) {
        let code = "PDF_URL_FETCH_FAILED";
        try {
          const payload = (await response.json()) as { error?: string };
          code = payload.error || code;
        } catch {
          /* ignore */
        }
        throw new Error(code);
      }
      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
      if (contentType && !contentType.includes("pdf")) {
        const magic = Array.from(bytes.slice(0, 4)).join(",");
        if (magic !== "37,80,68,70") throw new Error("INVALID_PDF_FILE");
      }
      const name = url.split("/").pop()?.split("?")[0] || "论文.pdf";
      setProgressIdx(0);
      setPhase("progress");
      const storagePath = await uploadPdfBytes(bytes, name.endsWith(".pdf") ? name : `${name}.pdf`);
      await finishImport(storagePath, name.endsWith(".pdf") ? name : `${name}.pdf`, url, bytes.byteLength);
    } catch (err) {
      setError(humanError(toAppError(err)));
      setPhase("form");
      setWorking(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar
        title="添加文献"
        subtitle={phase === "done" ? "完成" : undefined}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: inset.bottom + 20 }}>
        {phase === "form" ? (
          <>
            <View style={[styles.tabs, { borderColor: t.border }]}>
              {(["upload", "doi"] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={[
                    styles.tab,
                    tab === key && { backgroundColor: t.bg, borderColor: t.accent },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: tab === key ? t.primary : t.text2,
                      fontWeight: tab === key ? "500" : "400",
                    }}
                  >
                    {key === "upload" ? "上传 PDF" : "DOI / 链接"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {tab === "upload" ? (
              <Pressable
                onPress={() => void pickAndImport()}
                style={[styles.dropzone, { borderColor: t.border }]}
              >
                <Icon name="upload-file" size={32} color={t.accent} />
                <Text style={{ fontSize: 13, color: t.text2, marginTop: 6 }}>
                  点按选择本地 PDF 文件
                </Text>
                <Text style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
                  支持 PDF，最大 50MB
                </Text>
              </Pressable>
            ) : (
              <View style={{ marginTop: 8 }}>
                <AppText variant="label" style={{ marginBottom: 6 }}>
                  DOI 或论文链接
                </AppText>
                <TextInput
                  value={doi}
                  onChangeText={setDoi}
                  placeholder="10.1038/s41586-024-xxxxx 或 https://…"
                  placeholderTextColor={t.text3}
                  style={[styles.input, { backgroundColor: t.bg, borderColor: t.border, color: t.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  title="解析并添加"
                  loading={working}
                  style={{ marginTop: 14 }}
                  onPress={() => void importDoi()}
                />
              </View>
            )}
          </>
        ) : null}

        {phase === "progress" ? (
          <View style={styles.progressCard}>
            <AppText variant="body" style={{ marginBottom: 14 }}>
              正在添加文献…
            </AppText>
            <ProgressSteps steps={STEPS} activeIndex={progressIdx} />
          </View>
        ) : null}

        {phase === "done" ? (
          <View style={styles.progressCard}>
            <Icon name={result === "duplicate" ? "info" : "check-circle"} size={40} color={result === "duplicate" ? t.cite : t.accent} />
            <AppText variant="title" style={{ marginTop: 10 }}>
              {result === "duplicate" ? "文献已存在" : "文献已添加"}
            </AppText>
            <AppText variant="small" style={{ marginTop: 4, textAlign: "center" }}>
              {result === "duplicate"
                ? "这篇文献已在你的文献库中"
                : "已保存到文献库，可随时在论文详情中阅读"}
            </AppText>
            <Button
              title="完成"
              style={{ marginTop: 18, alignSelf: "stretch" }}
              onPress={() => router.back()}
            />
          </View>
        ) : null}

        {error ? (
          <View style={[styles.errorBox, { borderColor: t.danger }]}>
            <Icon name="error-outline" size={16} color={t.danger} />
            <Text style={{ color: t.danger, fontSize: 13, flex: 1 }}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: "transparent",
  },
  dropzone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 32,
    alignItems: "center",
  },
  input: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 0.5,
    fontSize: 14,
  },
  progressCard: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 4,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 0.5,
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
});
