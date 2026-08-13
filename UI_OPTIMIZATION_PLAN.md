# PDF AI Reader 界面优化方案

本文只描述界面与交互方案，不修改现有代码。基线为当前实现：`apps/extension/src/main.tsx`（单文件 App + PageView）与 `apps/extension/src/style.css`（约 260 行手写 CSS）。

## 1. 现状诊断

按影响阅读体验的程度排序。

### 1.1 视觉层

| 问题 | 现状 | 影响 |
| --- | --- | --- |
| 无设计变量 | 颜色全部硬编码，紫色出现三个值：`#4b2d86`（按钮）、`#3c2b69`（标题）、`#7e57c2`（选区） | 品牌色不统一，改主题需全局搜索替换 |
| 字号偏小且单一 | 正文、按钮、状态、结果几乎都是 12px | 长时间阅读疲劳；层级靠不出来 |
| 中文字体缺失 | `font-family` 只有 `Inter, system-ui` | Linux/Windows 下中文回退到默认字形，字重与西文不匹配 |
| 灰阶过多 | `#eef0f5 / #f4f5f8 / #e9ebf1 / #dfe2e8 / #eceef2` 五种相近底色与描边混用 | 界面发灰、缺少焦点，页面纸张与背景对比不足 |
| 顶部占用过高 | header 52px + toolbar 48px = 100px 固定层 | 竖屏可视页面高度被吃掉，两条栏功能上可合并 |
| 无深色模式 | 仅浅色 | 夜间阅读刺眼，PDF 白底也需要配套降亮方案 |

### 1.2 阅读功能

- 工具栏只有放大/缩小，缺少 `DEVELOPMENT_PLAN.md` 第一阶段要求的目录、页码跳转、文本搜索、适宽/适页、阅读位置恢复。
- 页面一次性全量渲染：`Array.from({ length: pdf.numPages })` 一次挂载全部 `PageView`，且 `key={`${i+1}-${scale}`}` 把 scale 写进 key，每次缩放会销毁并重建所有页面、重跑 `getTextContent()` 与 `page.render()`。百页论文缩放一次即卡顿，属于交互体验问题。
- 没有加载态与错误态：打开大文件时界面无反馈；加密 PDF、损坏文件、扫描件（无文本层）都没有提示。
- 页面之间只有 12px 间隔且无页码标识，连续滚动时不知道当前在第几页。

### 1.3 划词浮层

这是当前最需要重做的部分。

- **浮层会堆积**：每次 `mouseup` 都 `push` 一条 selection，旧浮层不会消失，多次划词后互相遮挡，只能逐个点 `×` 关闭。
- **坐标会失效**：`x/y` 是划词时相对 `.document-scroll` 的绝对像素。缩放后页面尺寸变化，浮层位置不再对应原文；页面重渲染时更明显。
- **会溢出视口**：固定 `width: 270px` + `translateX(-50%)`，在页面左右边缘或靠底部划词时浮层被裁切，没有翻转/贴边逻辑。
- **缺少常规关闭方式**：不支持 Esc、点击空白处关闭、滚动跟随。
- **原文无持久高亮**：`::selection` 一失焦就消失，翻译结果与原文的对应关系丢失。
- **结果区无状态区分**：翻译中、翻译成功、翻译失败、占位文案（“解释结果将在接入 AI 后显示”）共用同一个 `.popover-result` 样式，用户分不清成功与失败。

### 1.4 AI 面板

- 固定 390px，不可折叠、不可拖拽调宽；小屏直接 `display: none`，AI 能力整体消失。
- 空状态是一段 60 字长句，信息密度低且没有可执行入口（生成摘要、三行总结）。
- 输入框 `disabled` 且无说明，看起来像坏了；对话区只有一条硬编码消息。
- 缺少后续阶段必需的容器：摘要区、引用卡片、划词记录、模型切换、额度提示。

### 1.5 无障碍与工程

- 无 `:focus-visible` 样式，键盘用户看不到焦点。
- 翻译结果异步写入，没有 `aria-live`，读屏无播报。
- 浮层不是语义化 dialog/popover，没有焦点管理与 `Escape` 处理。
- `manifest.json` 用 `default_popup: index.html`，阅读器被塞进扩展弹窗（宽度上限约 800px、高度约 600px），与双栏布局冲突。阅读器应走独立标签页。

## 2. 设计目标

1. **可读优先**：视口 80% 以上给文档，界面层薄且安静。
2. **一套语义化 token**：颜色、间距、圆角、阴影、字号全部走变量，浅/深色只换变量值。
3. **划词即所得**：一次一个浮层，跟随原文位置，原文保留高亮，结果状态清晰。
4. **渐进承载后续能力**：面板结构预留摘要、引用跳转、模型切换、额度，不必推翻重做。
5. **零阻塞降级**：AI 未接入时展示明确的“未接入”状态，而不是灰掉的控件。

## 3. 目标布局

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ▤  PDF AI Reader   论文标题.pdf         ⌕搜索   12/48  ⊟ 118% ⊞  ⤢  ☾  ▦ │ 48px 单栏
├────────────┬─────────────────────────────────────────┬───────────────────┤
│ 目录/缩略图 │                                          │  AI 助手          │
│ (可折叠)    │            ┌───────────────┐             │ ┌───────────────┐ │
│            │            │               │             │ │摘要│问答│划词│ │
│ 1 Intro    │            │   page sheet  │             │ ├───────────────┤ │
│ 2 Method   │            │               │             │ │ 内容区         │ │
│   2.1 ...  │            └───────────────┘             │ │               │ │
│ 3 Results  │              ▲ 单一划词浮层               │ │               │ │
│            │            ┌───────────────┐             │ ├───────────────┤ │
│            │            │   page sheet  │             │ │ 输入框         │ │
│ 240px 可拖 │            └───────────────┘             │ │ 360–520px 可拖│ │
└────────────┴─────────────────────────────────────────┴───────────────────┘
                                    ▲ 底部悬浮页码胶囊（滚动时淡入）
```

要点：

- header 与 toolbar 合并为一条 48px 顶栏，右侧放全屏、主题、面板开关。
- 左栏新增，默认折叠（窄文档不打扰），`Ctrl/Cmd + \` 或点击 ▤ 切换。
- 中间阅读区背景比页面纸张深一档，纸张用单层柔和阴影，页间距 24px，页间显示页码分隔。
- 右栏可拖拽 360–520px，可整体折叠为 44px 图标条。
- 布局用 CSS Grid，列宽绑定变量，折叠只改变量值，配合 `transition` 得到平滑收起。

```css
.workspace {
  display: grid;
  grid-template-columns: var(--rail-w, 0px) minmax(0, 1fr) var(--panel-w, 400px);
  transition: grid-template-columns .18s var(--ease-out);
}
```

## 4. 设计 token

单一来源写在 `style.css` 顶部（或独立 `tokens.css`）。全部语义命名，禁止在组件里出现裸 hex。

```css
:root {
  /* 品牌：统一为一条紫色阶梯，替换现有三个不同紫 */
  --brand-50:  #f3efff;
  --brand-100: #e6dcff;
  --brand-300: #b39ef0;
  --brand-500: #6d4bc4;   /* 主色：按钮、选中、链接 */
  --brand-600: #5a3aab;   /* hover */
  --brand-700: #472c88;   /* active / 标题 */

  /* 中性：从 5 种相近灰收敛为一条阶梯 */
  --gray-0:  #ffffff;
  --gray-25: #fbfbfd;
  --gray-50: #f5f6f9;
  --gray-100:#eceef3;
  --gray-200:#dee1e9;
  --gray-400:#9aa1b1;
  --gray-600:#5b6270;
  --gray-800:#2b2f38;
  --gray-900:#191c22;

  /* 语义色 */
  --surface:        var(--gray-0);      /* 面板、浮层 */
  --surface-subtle: var(--gray-50);     /* 顶栏、侧栏 */
  --surface-sunken: var(--gray-100);    /* 阅读区底 */
  --paper:          #ffffff;            /* PDF 纸张 */
  --border:         var(--gray-200);
  --border-strong:  var(--gray-400);
  --text:           var(--gray-900);
  --text-secondary: var(--gray-600);
  --text-muted:     var(--gray-400);
  --accent:         var(--brand-500);
  --accent-soft:    var(--brand-50);
  --success:        #1f8a5f;
  --warning:        #b7791f;
  --danger:         #c0392f;
  --highlight:      #f7d774;            /* 划词持久高亮 */
  --selection:      color-mix(in srgb, var(--brand-500) 28%, transparent);

  /* 字体：补齐中文回退，正文提到 13/14px */
  --font-sans: "Inter", -apple-system, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  --fs-xs: 12px;   /* 辅助信息、标签 */
  --fs-sm: 13px;   /* 控件、次要文本 */
  --fs-md: 14px;   /* 正文、AI 回答 */
  --fs-lg: 16px;   /* 面板标题 */
  --fs-xl: 20px;   /* 空状态主标题 */
  --lh-tight: 1.35;
  --lh-body: 1.65;   /* 中文长文本必需 */

  /* 间距：4px 基准，只用这 7 档 */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;

  --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-full: 999px;

  --shadow-sm: 0 1px 2px rgb(16 20 28 / .06);
  --shadow-md: 0 4px 14px rgb(16 20 28 / .10);
  --shadow-lg: 0 12px 32px rgb(16 20 28 / .16);

  --ease-out: cubic-bezier(.22, .61, .36, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;

  --topbar-h: 48px;
  --z-popover: 40;
  --z-toast: 60;
}
```

深色模式只覆盖变量，组件 CSS 不动：

```css
:root[data-theme="dark"] {
  --surface: #1b1e25;  --surface-subtle: #15181e; --surface-sunken: #0f1116;
  --border: #2b303a;   --border-strong: #3c4250;
  --text: #e8eaf0;     --text-secondary: #a4abb9; --text-muted: #6f7785;
  --accent: #a98cf0;   --accent-soft: #241d3a;
  --paper: #ffffff;    /* 纸张保持白色，用 --paper-dim 降亮 */
  --paper-dim: .88;    /* canvas 上加 filter: brightness(var(--paper-dim)) */
  --shadow-md: 0 4px 14px rgb(0 0 0 / .45);
}
```

深色下 PDF 纸张处理：默认 `filter: brightness(.88) contrast(1.02)` 轻降亮；另提供“反色阅读”开关（`invert(1) hue-rotate(180deg)`），保证图片不被破坏时才建议开启，需在设置里注明对彩色图表有影响。

## 5. 组件方案

### 5.1 顶栏（TopBar，48px）

三段式：左（结构）· 中（导航）· 右（视图）。

- 左：面板开关 ▤、Logo + 产品名、当前文件名（`text-overflow: ellipsis`，hover 显示全名）。
- 中：搜索入口（收起为图标，`Ctrl/Cmd + F` 展开为输入框，显示 `3/17` 命中计数与上下箭头）、页码输入 `12 / 48`（可直接输入跳转）。
- 右：缩放组 `− 118% +`（点击百分比弹出 50%–400% 与 适宽/适页/实际大小）、全屏、主题切换、AI 面板开关。
- 未打开文档时，中段与缩放组隐藏，只留“打开 PDF”主按钮，避免出现一排失效控件。
- 所有图标按钮 32×32px，`--r-sm` 圆角，hover `--gray-100`，按下 `--gray-200`，选中态 `--accent-soft` + `--accent` 图标色。

### 5.2 左侧导航栏（Rail，默认折叠）

- 两个 Tab：`目录`（PDF.js `getOutline()`）、`缩略图`（低 scale 渲染 + 懒加载）。
- 目录支持多级缩进、展开/折叠、当前章节高亮（依据滚动位置反查最近页）。
- 缩略图 120px 宽，当前页 2px `--accent` 边框。
- 无书签的 PDF：目录 Tab 显示“该文档未提供目录”，并引导切到缩略图，不显示空白。

### 5.3 阅读区（Viewer）

- 纸张：`background: var(--paper)`、`--r-sm`、`--shadow-md`，页间距 `--sp-5`；纸张与 `--surface-sunken` 背景形成明确对比。
- 页码标识：每页右上角一枚半透明胶囊 `第 12 页`，滚动停止 1s 后淡出。
- 底部悬浮页码胶囊：滚动时淡入，显示 `12 / 48` 与细进度条，2s 无操作淡出。
- **渲染策略改造**（直接影响交互流畅度）：
  - 用 `IntersectionObserver` 只渲染视口 ±1 屏内的页面，其余保留占位盒（高度按 viewport 预算，避免滚动条跳动）。
  - `key` 只用页码，scale 变化走 `useEffect` 重渲染，不销毁组件；缩放期间先 CSS `transform: scale()` 即时预览，`requestIdleCallback` 后重绘清晰图层。
  - 页面渲染中显示骨架（灰底 + 轻微 shimmer），而不是空白。
- 空状态（未打开文档）：居中卡片，虚线描边拖放区，主标题 `--fs-xl`，一行说明 + 主按钮 + 快捷键提示；拖拽悬停时描边变 `--accent` 且底色 `--accent-soft`。
- 错误状态：加密/损坏/无文本层各一条明确文案与可执行建议（例如“该文档疑似扫描件，暂不支持文本选择与 AI 问答”），对应 `DEVELOPMENT_PLAN.md` 2.6 的要求。

### 5.4 划词浮层（Selection Popover）—— 重点重做

**状态模型**：从数组改为单一 `activeSelection`，历史结果沉到右侧“划词记录”Tab。

```ts
type Anchor = {
  pageNumber: number;
  // 相对页面的归一化坐标（0–1），与 scale 解耦
  nx: number; ny: number; nw: number; nh: number;
};
type ActiveSelection = {
  id: string;
  text: string;
  anchor: Anchor;
  task?: { kind: 'translate' | 'explain'; state: 'loading' | 'done' | 'error'; result?: string; message?: string };
};
```

归一化坐标（`nx = (rect.left - pageRect.left) / pageRect.width`）解决当前缩放后浮层错位的问题：渲染时再乘当前页面尺寸换算成像素。

**定位规则**：

- 默认贴在选区下方 8px、水平居中；下方空间不足 200px 时翻到上方。
- 距视口左右边缘小于 12px 时贴边，箭头随之偏移。
- 建议直接引入 `@radix-ui/react-popover`（`DEVELOPMENT_PLAN.md` 已列 Radix 为依赖），免费获得碰撞翻转、焦点陷阱、`Escape` 关闭、点击外部关闭、`aria` 属性，比手写 `translateX(-50%)` 可靠。

**结构与行为**：

```text
┌─────────────────────────────────────┐
│ “selected text …”            ⋯  ×  │  原文，最多 3 行，超出折叠 + “展开”
├─────────────────────────────────────┤
│  译  翻译   ✧ 解释   ⌸ 深入   ＋提问 │  4 个操作，图标 + 文字
├─────────────────────────────────────┤
│ ▍译文  ····································│  结果区：状态化
│  百度翻译 · 0.4s            ⧉ 复制  │  来源与耗时，右下复制
└─────────────────────────────────────┘
```

- 宽度 `min(360px, 视口 - 32px)`，比现在 270px 更适合中文译文换行。
- 结果区四态：`loading` 用三行骨架 + “翻译中”，`done` 正常文本 + 来源标签 + 复制按钮，`error` 用 `--danger` 左边框 + 原因 + “重试”按钮，`unavailable`（AI 未接入）用 `--warning` 底色的说明条，与失败区分开。
- 操作按钮加 loading 内联态并禁用重复点击（当前 `translateSelection` 可被连点）。
- 关闭方式：`×`、`Escape`、点击文档空白处、开始新的划词自动替换。
- 划词后在文本层叠加一层持久高亮矩形（`--highlight`，`mix-blend-mode: multiply`），浮层关闭后高亮保留在“划词记录”里，可点击回跳。
- 结果区加 `aria-live="polite"`，读屏可播报翻译完成。
- 移动/窄屏（<760px）：浮层改为底部 Sheet，避免遮挡正文。

### 5.5 AI 面板（右栏）

- 头部：标题 + 模型选择器（未接入时显示“未配置”并可点开说明）+ 折叠按钮。
- 三个 Tab：
  - **摘要**：三行摘要卡 + 全文摘要（按章节分组，每条带页码 chip 可跳转）；未生成时给“生成摘要”主按钮 + 预计耗时说明。
  - **问答**：消息流 + 输入区。用户气泡 `--accent-soft` 右对齐，AI 气泡无底色左对齐（长文本更易读），流式输出显示光标闪烁；回答下方引用卡片 `[p.12] 原文片段…`，点击滚动到对应页并闪烁高亮。
  - **划词**：按页分组的选区记录，每条含原文、译文/解释、时间，支持点击回跳与删除。
- 输入区：`textarea` 自动增高（最多 5 行），`Enter` 发送 / `Shift+Enter` 换行，右下角发送按钮，下方一行额度提示。AI 未接入阶段不要 `disabled`，改为占位说明条“AI 问答将在接入后开放”，控件保持可见但不可用状态明确。
- 空状态给 3 个可点的建议问题（“这篇论文的核心贡献是什么”等），降低冷启动成本。
- 拖拽调宽：面板左边缘 4px 热区，`col-resize` 光标，宽度写入 `localStorage`；折叠为 44px 图标条。

### 5.6 反馈与动效

- Toast（右下，`--z-toast`）：复制成功、翻译失败、文件类型错误。
- 顶部 2px 进度条：PDF 解析、索引、摘要生成等长任务。
- 动效克制：浮层 `120ms` 淡入 + 4px 上移；面板宽度 `180ms`；页面切换不做动画。统一遵守 `@media (prefers-reduced-motion: reduce)` 关闭动效。

## 6. 键盘与交互约定

| 快捷键 | 行为 |
| --- | --- |
| `Ctrl/Cmd + O` | 打开文件 |
| `Ctrl/Cmd + F` | 文档内搜索 |
| `Ctrl/Cmd + \` | 切换左侧目录栏 |
| `Ctrl/Cmd + J` | 切换右侧 AI 面板 |
| `Ctrl/Cmd + +` / `-` / `0` | 放大 / 缩小 / 实际大小 |
| `PageUp` / `PageDown` / `Home` / `End` | 翻页与首尾 |
| 划词后 `T` / `E` | 翻译 / 解释当前选区 |
| `Escape` | 关闭浮层、退出搜索 |
| `Enter` / `Shift+Enter` | 发送 / 换行 |

无障碍基线：

- 全局 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`，禁止 `outline: none` 不补替代。
- 正文对比度 ≥ 4.5:1，辅助文字 ≥ 3:1（当前 `--text-muted` 级别的 `#9aa1b1` 只可用于非关键信息）。
- 图标按钮必须有 `aria-label` 与 tooltip；浮层用 `role="dialog"` + `aria-modal="false"` + 焦点管理。
- 状态不只靠颜色：错误配图标，成功配文字。

## 7. 实施阶段

按“先止损、再增强”排序，每阶段可独立发布。

**P0 视觉基线（0.5–1 天）**
落 token 文件、统一紫色与灰阶、字体与字号、合并顶栏为 48px、加 `:focus-visible`、重写空状态与加载/错误态。不改数据结构，收益立刻可见。

**P1 划词浮层重做（1–1.5 天）**
`selections[]` → `activeSelection` + 记录列表；坐标归一化；接入 Radix Popover 处理翻转与关闭；结果区四态；持久高亮层；操作防连点。这一阶段修掉当前最明显的三个交互缺陷（堆积、错位、溢出）。

**P2 阅读器能力补齐（2–3 天）**
左侧目录/缩略图、页码跳转、搜索、适宽/适页、底部页码胶囊、按视口懒渲染 + 缩放不重建组件、阅读位置恢复（按文档指纹存 `localStorage`）。

**P3 AI 面板结构化（1.5–2 天）**
Tabs、可折叠与拖拽调宽、消息流与引用卡片、自动增高输入、建议问题、额度位。为第三阶段 SSE 接入留好插槽。

**P4 主题与响应式（1 天）**
深色模式（含纸张降亮/反色开关）、跟随系统、`<760px` 下右栏改底部 Sheet 而非隐藏、`prefers-reduced-motion`。

**P5 工程配套（0.5 天）**
`manifest.json` 的 `default_popup` 改为点击图标打开独立标签页（`chrome.tabs.create`），弹窗只保留“打开阅读器/最近文档”窄面板；`index.html` 补 `lang="zh-CN"`、`meta viewport`、`title` 与首屏防闪主题脚本。

## 8. 技术选型建议

- **CSS 方案**：现阶段继续手写 CSS + 变量即可，把 `style.css` 拆为 `tokens.css / base.css / layout.css / components/*.css`。若确定按 `DEVELOPMENT_PLAN.md` 引入 Tailwind，则把上面的 token 直接映射到 `theme.extend`，避免两套色值并存。
- **建议现在就引入 Radix**：`Popover`、`Tooltip`、`Tabs`、`DropdownMenu`、`Dialog`。浮层定位、焦点管理、键盘行为是当前最薄弱的部分，也是最不值得手写的部分。
- **图标**：`lucide-react`，统一 16px 线宽 1.5。
- **组件拆分**：`main.tsx` 目前 285 行承载全部逻辑，建议拆为 `App / TopBar / OutlineRail / Viewer / PageView / SelectionPopover / AssistantPanel`，样式与组件同名共处，便于后续多人协作。
- **状态**：视图状态（scale、面板宽度、主题、fit 模式）用 Zustand 单 store 并持久化；文档与选区状态独立，避免缩放触发浮层重算。

## 9. 验收清单

视觉

- [ ] 代码中不出现裸 hex（token 定义文件除外）
- [ ] 浅色/深色下正文对比度 ≥ 4.5:1
- [ ] 顶部界面层总高 ≤ 48px，阅读区占竖向空间 ≥ 82%

交互

- [ ] 同一时间最多一个划词浮层
- [ ] 缩放 60%→300% 后浮层仍准确贴合原文
- [ ] 页面左/右/底部边缘划词，浮层完整可见
- [ ] Esc、点击空白、新划词均可关闭浮层
- [ ] 翻译中、成功、失败、未接入四态视觉可区分
- [ ] 连点“翻译”不会发出重复请求

性能

- [ ] 100 页 PDF 首屏可交互 < 1.5s
- [ ] 缩放一次不重建全部页面，主线程阻塞 < 200ms
- [ ] 滚动帧率 ≥ 50fps（Chrome Performance 面板抽样）

无障碍

- [ ] 键盘可完成：打开文件 → 跳页 → 搜索 → 划词操作 → 提问
- [ ] 所有图标按钮有 `aria-label`
- [ ] 异步结果区有 `aria-live`
- [ ] `prefers-reduced-motion: reduce` 下无位移动画

响应式

- [ ] 1280px：三栏正常
- [ ] 1024px：左栏自动折叠
- [ ] 760px 以下：右栏转底部 Sheet，AI 能力不丢失
