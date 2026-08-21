// WebView + pdfjs PDF 阅读器：加载签名 URL → 取二进制 → base64 注入 → 渲染
// 页面滚动/翻页通过 postMessage 与 RN 同步（用于阅读进度保存与页码导航）。
import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { PDF_READER_HTML } from "./pdfReaderHtml.generated";
import { Spinner } from "@/components/ui/core";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

export interface PdfReaderHandle {
  gotoPage: (page: number) => void;
  zoomBy: (delta: number) => void;
  search: (query: string) => void;
  currentScale: number;
}

export function PdfReaderWebView({
  dataUrl,
  initialPage,
  onReady,
  onPageChange,
  onError,
  handleRef,
}: {
  dataUrl: string | null;
  initialPage?: number;
  onReady?: (numPages: number) => void;
  onPageChange?: (page: number, numPages: number) => void;
  onError?: (message: string) => void;
  handleRef?: React.MutableRefObject<PdfReaderHandle | null>;
}) {
  const webRef = useRef<WebView>(null);
  const scaleRef = useRef(1.25);
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      gotoPage: (page) =>
        webRef.current?.postMessage(JSON.stringify({ type: "goto", page })),
      zoomBy: (delta) => {
        scaleRef.current = Math.max(0.7, Math.min(2.2, scaleRef.current + delta));
        webRef.current?.postMessage(
          JSON.stringify({ type: "zoom", scale: scaleRef.current }),
        );
      },
      search: (query) =>
        webRef.current?.postMessage(JSON.stringify({ type: "search", query })),
      currentScale: scaleRef.current,
    };
  }, [handleRef]);

  // 初始页码用 ref 捕获：仅 dataUrl 变化时触发加载，避免阅读进度更新导致 WebView 重载重置滚动
  const initialPageRef = useRef(initialPage);
  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  useEffect(() => {
    if (!dataUrl) return;
    webRef.current?.postMessage(JSON.stringify({ type: "load", dataUrl }));
    const target = initialPageRef.current;
    if (target && target > 1) {
      setTimeout(() => {
        webRef.current?.postMessage(
          JSON.stringify({ type: "goto", page: target }),
        );
      }, 400);
    }
  }, [dataUrl]);

  const onMessage = (event: WebViewMessageEvent) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload.type === "ready") {
      onReady?.(Number(payload.numPages || 0));
    } else if (payload.type === "page") {
      onPageChange?.(Number(payload.page || 1), Number(payload.numPages || 0));
    } else if (payload.type === "error") {
      onError?.(String(payload.message || "PDF 加载失败"));
    }
  };

  if (!dataUrl) {
    return (
      <View style={styles.center}>
        <Spinner size="large" />
      </View>
    );
  }

  // Web 预览环境没有 react-native-webview 实现，给出占位提示（真机/模拟器可用完整阅读）
  const isWeb = Platform.OS === ("web" as typeof Platform.OS);
  if (isWeb) {
    return (
      <View style={styles.center}>
        <Text style={{ color: THEMES[theme].text3, fontSize: 13, textAlign: "center", paddingHorizontal: 24 }}>
          PDF 阅读请在真机（Expo Go）或模拟器中预览，网页版仅支持其他功能
        </Text>
      </View>
    );
  }

  return (
    <WebView
      ref={webRef}
      originWhitelist={["*"]}
      source={{ html: PDF_READER_HTML }}
      style={{ backgroundColor: t.bg }}
      containerStyle={{ backgroundColor: t.bg }}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      mixedContentMode="always"
      onMessage={onMessage}
      // iOS WKWebView 允许任意滚动
      bounces={false}
      scrollEnabled={false}
      overScrollMode="never"
      startInLoadingState
      renderLoading={() => (
        <View style={styles.center}>
          <Spinner size="large" />
        </View>
      )}
      injectedJavaScriptBeforeContentLoaded={
        // 供 html 内 window.ReactNativeWebView 使用（react-native-webview 已内置）
        `window.__shideaPlatform = ${Platform.OS === "web" ? "'web'" : "'native'"}; true;`
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
