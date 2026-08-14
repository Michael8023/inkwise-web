Sci-Hub 本身**没有公开的官方 API**，但有很多开发者基于它的网页逻辑，封装了非官方的库和工具，可以帮你实现“输入DOI，获取PDF”的功能。

这些工具的核心逻辑，其实就是帮你的网站去模拟浏览器行为，在Sci-Hub的页面上找到并提取出PDF文件的真实链接。你可以把它们看作是一个**API接口的替代方案**。

以下是几种主流的技术实现路径，你可以根据你的网站技术栈来选择：

### ⚙️ 方案一：使用Python库（最通用）

如果你的网站后端是Python，这是最直接的方式。

**1. `scihub-mcp` (推荐)**
这是一个较新的Python包，功能比较完整，不仅支持通过DOI获取PDF链接，还能获取论文的标题、作者等元数据。它会自动尝试多个Sci-Hub镜像，提高了成功率。

*   **安装与使用示例**:
    ```python
    # 安装（从GitHub直接安装）
    # pip install git+https://github.com/w8s/scihub-mcp

    from scihub_mcp.sci_hub_search import search_paper_by_doi

    # 输入DOI，获取结果
    result = search_paper_by_doi("10.1038/nature09492")
    if result["status"] == "success":
        print(f"PDF URL: {result['pdf_url']}")  # 这就是你需要的链接
    else:
        print("论文未找到")
    ```
*   **注意事项**：该库内置了多个镜像源，但如`sci-hub.se`等域名可能会失效。如果搜索结果为空，可以检查并更新库中的镜像列表。

**2. `scihub.py` (经典库)**
这是一个历史更悠久的非官方API库，功能同样强大，支持搜索和下载。不过，它有一个已知问题：可能会遇到验证码（Captcha）的阻碍。

### 🌐 方案二：使用Rust或TypeScript/Node.js库

如果你用的是Rust或Node.js技术栈，也有相应的解决方案。

*   **Rust**: 可以使用 [`scihub-rs`](https://github.com/Servus-Altissimi/scihub-rs) 或 [`scihub-scraper`](https://github.com/OpenByteDev/SciHub-Scraper)。它们都提供了异步客户端，能自动发现可用镜像并获取论文。例如，`scihub-scraper`的使用非常简洁:
    ```rust
    let mut scraper = Scraper::with_auto_detected_base_urls().await.unwrap();
    let paper = scraper.fetch_paper_by_doi("10.1016/j.tplants.2018.11.001").await.unwrap();
    println!("PDF Url = {}", paper.download_url);
    ```
*   **TypeScript/Node.js**: 有 [`sci-mcp-server`](https://www.npmjs.com/package/sci-mcp-server) 这个包。它提供了一个Model Context Protocol (MCP)服务器，但也支持以库的形式使用。它支持HTTP模式，可以直接从你的网站后端调用其HTTP接口来获取PDF链接。
    ```javascript
    // 以HTTP模式启动服务
    npx sci-mcp-server http --port 8080
    ```

### 🚧 潜在挑战与对策

1.  **镜像站不稳定**：这是最大的挑战。Sci-Hub的官方域名经常被封禁或更换。这些非官方库通常会维护一个镜像列表，但如果列表未及时更新，功能就会失效。**因此，你的网站需要能容忍一定程度的服务不可用，并考虑设计“手动更新镜像源”的管理功能。**
2.  **反爬虫机制**：Sci-Hub和Google Scholar（用于搜索）可能会对频繁的自动化请求弹出验证码。模拟真实浏览器的请求头（User-Agent）可以降低概率，但无法彻底解决。对于只通过DOI获取特定论文的场景，遇到验证码的概率相对较低，但仍需留意。

### 💡 备选路径：自行构造PDF链接

这虽然不是一个“API”，但却是最简单的技术方案。原理是：Sci-Hub的PDF下载链接通常遵循一个简单的模式。
*   **基础模式**：`https://[镜像站域名]/[DOI]`
*   **举例**：如果镜像站是 `sci-hub.se`，DOI是 `10.1038/nature09492`，那么PDF链接可能就是 `https://sci-hub.se/10.1038/nature09492`。

**缺点**是，这个链接并不总是直接指向PDF文件，有时是一个包含下载按钮的页面。而且，你需要手动维护一个可用的镜像站列表。

**总结一下**，最推荐的做法是**在你的网站后端集成一个上述的非官方库（如 `scihub-mcp`）**。这能帮你处理掉“寻找可用镜像”、“解析页面提取PDF链接”这些麻烦事，让你只需要专注于通过DOI去获取结果就行。

另外需要提醒一下，Sci-Hub的法律地位在不同国家/地区有争议，在考虑集成时需要留意相关的法律与版权风险。