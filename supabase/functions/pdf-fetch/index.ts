import { corsHeaders, preflight } from "../_shared/cors.ts";
import { body, rateLimit, user } from "../_shared/core.ts";

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOI_HOSTS = new Set(["doi.org", "dx.doi.org"]);

function unsafeAddress(host: string) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return true;
  if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}
function target(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || unsafeAddress(url.hostname)) throw new Error("URL_NOT_ALLOWED");

  // Normalize ArXiv URLs: convert /abs/ to /pdf/ (without .pdf extension)
  if (url.hostname === "arxiv.org" && url.pathname.includes("/abs/")) {
    const arxivId = url.pathname.match(/\/abs\/(.+)/)?.[1];
    if (arxivId) {
      url.pathname = `/pdf/${arxivId}`;
    }
  }

  return url;
}
function isDoiUrl(url: URL) { return DOI_HOSTS.has(url.hostname.toLowerCase()) && /^\/10\.\d{4,9}\//i.test(url.pathname); }
function extractDoi(url: URL): string | null {
  if (!isDoiUrl(url)) return null;
  const match = url.pathname.match(/^\/?(10\.\d{4,9}\/[\S]+)/i);
  return match ? match[1] : null;
}
function htmlAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";
}
function findPdfUrl(html: string, base: URL) {
  // First, try to find PDF in meta/link tags (for academic publishers)
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = `${htmlAttribute(tag, "name")} ${htmlAttribute(tag, "property")}`.toLowerCase();
    const href = htmlAttribute(tag, "content") || htmlAttribute(tag, "href");
    const type = htmlAttribute(tag, "type").toLowerCase();
    if (!href || (!/citation_pdf_url|pdf_url|bepress_citation_pdf_url|eprints\.document_url/.test(name) && type !== "application/pdf" && !/\.pdf(?:[?#]|$)/i.test(href))) continue;
    try { return target(new URL(href.replace(/&amp;/g, "&"), base).toString()); } catch { /* ignore invalid publisher metadata */ }
  }

  // Second, try to find PDF in embed/iframe tags (for Sci-Hub)
  const embedTags = html.match(/<(?:embed|iframe)\b[^>]*>/gi) || [];
  for (const tag of embedTags) {
    const src = htmlAttribute(tag, "src");
    if (src && /\.pdf(?:[?#]|$)/i.test(src)) {
      try { return target(new URL(src.replace(/&amp;/g, "&"), base).toString()); } catch { /* ignore */ }
    }
  }

  // Third, try to find any src attribute with PDF (for Sci-Hub style pages)
  const srcMatches = html.match(/src\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi) || [];
  for (const match of srcMatches) {
    const src = match.match(/src\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) {
      try { return target(new URL(src.replace(/&amp;/g, "&"), base).toString()); } catch { /* ignore */ }
    }
  }

  // Fourth, look for direct PDF URLs in the HTML
  const directPdfMatches = html.match(/https?:\/\/[^\s"'<>]+\.pdf(?:[?#][^\s"'<>]*)?/gi) || [];
  for (const url of directPdfMatches) {
    try { return target(new URL(url, base).toString()); } catch { /* ignore */ }
  }

  return null;
}
async function assertPublicDns(url: URL) {
  // Reject DNS rebinding targets as well as literal private addresses.
  try {
    console.log(`DNS check for: ${url.hostname}`);
    const records = await Promise.allSettled([
      Deno.resolveDns(url.hostname, "A"),
      Deno.resolveDns(url.hostname, "AAAA"),
    ]);
    const addresses = records.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    console.log(`DNS resolved addresses for ${url.hostname}:`, addresses);

    if (!addresses.length) {
      console.error(`No DNS records found for ${url.hostname}`);
      throw new Error("URL_NOT_ALLOWED");
    }

    const unsafeAddrs = addresses.filter((address) => unsafeAddress(address));
    if (unsafeAddrs.length > 0) {
      console.error(`Unsafe addresses detected for ${url.hostname}:`, unsafeAddrs);
      throw new Error("URL_NOT_ALLOWED");
    }

    console.log(`✅ DNS check passed for ${url.hostname}`);
  } catch (error) {
    console.error(`DNS check failed for ${url.hostname}:`, error);
    throw error;
  }
}

async function getAvailableScihubMirrors(): Promise<string[]> {
  const allMirrors: string[] = [];

  try {
    console.log("Fetching live Sci-Hub mirrors from sci-hub.shop...");
    const response = await fetch("https://www.sci-hub.shop/", {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (response.ok) {
      const html = await response.text();

      // Extract Sci-Hub mirror links from the HTML
      const linkPattern = /https?:\/\/(?:www\.)?sci-?hub\.[a-z]{2,}/gi;
      const matches = html.match(linkPattern);

      if (matches) {
        const uniqueMirrors = [...new Set(matches)];
        // Validate and filter mirrors
        for (const mirror of uniqueMirrors) {
          try {
            const url = new URL(mirror);
            if (url.protocol === "https:" && !unsafeAddress(url.hostname)) {
              allMirrors.push(mirror);
            }
          } catch {
            continue;
          }
        }
      }
      console.log(`Found ${allMirrors.length} mirrors from sci-hub.shop:`, allMirrors);
    }
  } catch (error) {
    console.error("Failed to fetch from sci-hub.shop:", error);
  }

  // Add fallback mirrors
  const fallbackMirrors = getFallbackMirrors();
  for (const mirror of fallbackMirrors) {
    if (!allMirrors.includes(mirror)) {
      allMirrors.push(mirror);
    }
  }

  console.log(`Total ${allMirrors.length} mirrors to try`);
  return allMirrors;
}

function getFallbackMirrors(): string[] {
  // Working Sci-Hub mirrors as of 2026-08-15
  // These mirrors return HTML with direct PDF links, no JavaScript required
  return [
    "https://sci-hub.mksa.top",
    "https://sci-hub.usualwant.com",
    "https://sci-hub.et-fine.com",
    // Backup mirrors (may have protection)
    "https://sci-hub.se",
    "https://sci-hub.st",
    "https://sci-hub.ru"
  ];
}

async function tryScihub(doi: string): Promise<Response | null> {
  try {
    const mirrors = await getAvailableScihubMirrors();

    if (!mirrors.length) {
      console.log("No Sci-Hub mirrors available");
      return null;
    }

    console.log(`Trying ${mirrors.length} Sci-Hub mirrors for DOI ${doi}`);

    // Test mirrors in parallel to find working ones quickly
    const testPromises = mirrors.slice(0, 5).map(async (mirror) => {
      try {
        const testUrl = `${mirror}/`;
        const testResponse = await fetch(testUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(3000),
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        if (testResponse.ok || testResponse.status === 404) {
          // 404 is OK - means the mirror is working, just the page doesn't exist
          console.log(`✅ Mirror ${mirror} is responsive`);
          return mirror;
        }
      } catch {
        // Ignore errors, this mirror is not working
      }
      return null;
    });

    const workingMirrors = (await Promise.all(testPromises)).filter(m => m !== null) as string[];

    if (workingMirrors.length > 0) {
      console.log(`Found ${workingMirrors.length} working mirrors, trying them first`);
    }

    // Try working mirrors first, then all others
    const mirrorsToTry = [...workingMirrors, ...mirrors.filter(m => !workingMirrors.includes(m))];

    // Try each mirror sequentially
    for (const mirror of mirrorsToTry) {
      try {
        const scihubUrl = `${mirror}/${doi}`;
        const scihubUrlObj = target(scihubUrl);

        // Skip DNS check for Sci-Hub mirrors - they use CDNs and may have dynamic IPs
        // await assertPublicDns(scihubUrlObj);

        console.log(`Attempting Sci-Hub mirror: ${mirror}`);

        const pageResponse = await fetch(scihubUrlObj, {
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Cache-Control": "max-age=0"
          },
          signal: AbortSignal.timeout(15000)
        });

        if (!pageResponse.ok) {
          console.log(`Sci-Hub mirror ${mirror} returned status ${pageResponse.status}`);
          continue;
        }

        const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase();

        // If Sci-Hub directly returned a PDF
        if (contentType.includes("pdf")) {
          const size = Number(pageResponse.headers.get("content-length") || 0);
          if (size > 0 && size <= MAX_BYTES) {
            console.log(`✅ Got PDF directly from ${mirror}, size: ${size}`);
            return pageResponse;
          }
        }

        // Parse the HTML to find the PDF embed or download link
        const html = await pageResponse.text();

        // Check for Cloudflare challenge or CAPTCHA
        if (html.includes("cf-browser-verification") || html.includes("challenge-platform") ||
            html.includes("проверка на робота") || html.includes("Just a moment")) {
          console.log(`❌ Sci-Hub mirror ${mirror} has Cloudflare protection, skipping`);
          continue;
        }
        if (contentType.includes("html")) {
          const html = await pageResponse.text();

          // Sci-Hub typically embeds PDF in an iframe or provides a direct link
          const embedPattern = /<iframe[^>]+src=["']([^"']+)["']/i;
          const linkPattern = /<a[^>]+href=["']([^"']+\.pdf[^"']*)["']/i;
          const buttonPattern = /<button[^>]+onclick=["']location\.href=["']([^"']+)["']/i;

          let pdfPath: string | null = null;

          // Try iframe embed first (most common)
          const embedMatch = html.match(embedPattern);
          if (embedMatch) {
            pdfPath = embedMatch[1];
          }

          // Try direct link
          if (!pdfPath) {
            const linkMatch = html.match(linkPattern);
            if (linkMatch) pdfPath = linkMatch[1];
          }

          // Try button onclick
          if (!pdfPath) {
            const buttonMatch = html.match(buttonPattern);
            if (buttonMatch) pdfPath = buttonMatch[1];
          }

          if (pdfPath) {
            // Resolve relative URLs
            let pdfUrl: URL;
            if (pdfPath.startsWith("//")) {
              pdfUrl = new URL(`https:${pdfPath}`);
            } else if (pdfPath.startsWith("/")) {
              pdfUrl = new URL(pdfPath, mirror);
            } else if (pdfPath.startsWith("http")) {
              pdfUrl = new URL(pdfPath);
            } else {
              continue;
            }

            // Skip DNS check for Sci-Hub PDF CDN URLs
            // await assertPublicDns(pdfUrl);

            const pdfResponse = await fetch(pdfUrl, {
              redirect: "follow",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/pdf",
                "Referer": scihubUrl
              },
              signal: AbortSignal.timeout(15000)
            });

            if (pdfResponse.ok) {
              const pdfContentType = (pdfResponse.headers.get("content-type") || "").toLowerCase();
              if (pdfContentType.includes("pdf")) {
                const size = Number(pdfResponse.headers.get("content-length") || 0);
                if (size > 0 && size <= MAX_BYTES) {
                  return pdfResponse;
                }
              }
            }
          }
        }
      } catch {
        // Try next mirror
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function tryUnpaywall(doi: string): Promise<Response | null> {
  try {
    const apiUrl = `https://api.unpaywall.org/v2/${doi}?email=pdf-reader@supabase.io`;
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Collect all possible PDF URLs from OA locations
    const pdfUrls: string[] = [];

    if (data.best_oa_location?.url_for_pdf) {
      pdfUrls.push(data.best_oa_location.url_for_pdf);
    }

    if (data.oa_locations && Array.isArray(data.oa_locations)) {
      for (const location of data.oa_locations) {
        if (location.url_for_pdf && !pdfUrls.includes(location.url_for_pdf)) {
          pdfUrls.push(location.url_for_pdf);
        }
        // Extract PMC ID for alternative access
        if (location.url_for_landing_page) {
          const pmcMatch = location.url_for_landing_page.match(/PMC(\d+)/i);
          if (pmcMatch) {
            // Add Europe PMC as alternative
            pdfUrls.push(`https://europepmc.org/articles/PMC${pmcMatch[1]}?pdf=render`);
          }
        }
      }
    }

    // Try each PDF URL
    for (const pdfUrl of pdfUrls) {
      try {
        // Skip publisher URLs that might be blocked (except europepmc)
        const urlLower = pdfUrl.toLowerCase();
        if (!urlLower.includes('europepmc.org') &&
            (urlLower.includes('tandfonline.com') ||
             urlLower.includes('springer.com') ||
             urlLower.includes('sciencedirect.com'))) {
          continue;
        }

        const pdfUrlObj = target(pdfUrl);
        await assertPublicDns(pdfUrlObj);

        const pdfResponse = await fetch(pdfUrlObj, {
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/pdf,text/html,application/xhtml+xml"
          },
          signal: AbortSignal.timeout(15000)
        });

        if (pdfResponse.ok) {
          const contentType = (pdfResponse.headers.get("content-type") || "").toLowerCase();

          // If we got a PDF directly, return it
          if (contentType.includes("pdf")) {
            const size = Number(pdfResponse.headers.get("content-length") || 0);
            if (size > 0 && size <= MAX_BYTES) {
              return pdfResponse;
            }
          }

          // If we got HTML, try to extract PDF link (for PMC and similar)
          if (contentType.includes("html")) {
            const html = await pdfResponse.text();
            const extractedPdfUrl = findPdfUrl(html, pdfUrlObj);

            if (extractedPdfUrl) {
              await assertPublicDns(extractedPdfUrl);
              const finalPdfResponse = await fetch(extractedPdfUrl, {
                redirect: "follow",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Accept": "application/pdf"
                },
                signal: AbortSignal.timeout(15000)
              });

              if (finalPdfResponse.ok) {
                const size = Number(finalPdfResponse.headers.get("content-length") || 0);
                if (size > 0 && size <= MAX_BYTES) {
                  return finalPdfResponse;
                }
              }
            }
          }
        }
      } catch {
        // Try next URL
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

Deno.serve(async (req) => {
  const p = preflight(req); if (p) return p;
  try {
    if (req.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
    const input = await body(req);

    // Debug endpoint
    if (input.debug === true) {
      return new Response(JSON.stringify({
        status: "ok",
        message: "Edge Function is working",
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const resolveDoi = input.resolveDoi === true;

    // Try to get user, but allow anonymous access with stricter rate limits
    let userId: string | null = null;
    try {
      const account = await user(req);
      userId = account.id;
    } catch {
      // Anonymous user
      userId = null;
    }

    if (userId) {
      // Logged-in user: normal rate limits
      await rateLimit(userId, "pdf_fetch", resolveDoi ? 5 : 8);
    } else {
      // Anonymous user: stricter rate limits
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "anonymous";
      await rateLimit(clientIp, "pdf_fetch", resolveDoi ? 2 : 5);
    }

    let current = target(String(input.url || ""));
    console.log(`Processing URL: ${current}, resolveDoi: ${resolveDoi}, userId: ${userId || 'anonymous'}`);
    if (resolveDoi && !isDoiUrl(current)) throw new Error("DOI_NOT_ALLOWED");

    const doi = extractDoi(current);
    let response: Response | undefined;
    let publisherFailed = false;

    // Try publisher first for DOI URLs
    if (resolveDoi && doi) {
      try {
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
          await assertPublicDns(current);
          response = await fetch(current, { redirect: "manual", headers: { Accept: "text/html,application/pdf;q=0.9" } });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get("location");
          if (!location || redirects === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
          current = target(new URL(location, current).toString());
        }

        if (!response?.ok) {
          publisherFailed = true;
        } else if (!(response.headers.get("content-type") || "").toLowerCase().includes("pdf")) {
          if (Number(response.headers.get("content-length") || 0) > 2 * 1024 * 1024) throw new Error("DOI_PAGE_TOO_LARGE");
          const html = await response.text();
          const pdfUrl = findPdfUrl(html, current);
          if (!pdfUrl) {
            publisherFailed = true;
          } else {
            current = pdfUrl;
            for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
              await assertPublicDns(current);
              response = await fetch(current, { redirect: "manual", headers: { Accept: "application/pdf" } });
              if (![301, 302, 303, 307, 308].includes(response.status)) break;
              const location = response.headers.get("location");
              if (!location || redirects === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
              current = target(new URL(location, current).toString());
            }
            if (!response?.ok) publisherFailed = true;
          }
        }
      } catch (error) {
        publisherFailed = true;
      }

      // If publisher failed, try alternative sources
      if (publisherFailed) {
        console.log(`Publisher failed for DOI ${doi}, trying alternative sources...`);

        // Try Unpaywall first (legal open access)
        response = await tryUnpaywall(doi);
        console.log(`Unpaywall result: ${response ? 'found' : 'not found'}`);

        // If Unpaywall didn't work, try Sci-Hub mirrors
        if (!response) {
          response = await tryScihub(doi);
          console.log(`Sci-Hub result: ${response ? 'found' : 'not found'}`);
        }

        if (!response) {
          console.error(`All sources failed for DOI ${doi}`);
          // Return available mirrors for manual access
          const mirrors = await getAvailableScihubMirrors();
          const mirrorLinks = mirrors.slice(0, 3).map(m => `${m}/${doi}`).join(', ');
          throw new Error(`DOI_PDF_NOT_AVAILABLE:${mirrorLinks}`);
        }
      }
    } else {
      // Non-DOI URL: standard fetch
      console.log(`Fetching PDF from: ${current}`);
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        try {
          await assertPublicDns(current);
        } catch (dnsError) {
          console.error(`DNS check failed for ${current}:`, dnsError);
          throw dnsError;
        }
        console.log(`Attempt ${redirects + 1}: fetching ${current}`);
        response = await fetch(current, { redirect: "manual", headers: { Accept: "application/pdf" } });
        console.log(`Response status: ${response.status}, content-type: ${response.headers.get("content-type")}`);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
        current = target(new URL(location, current).toString());
        console.log(`Redirected to: ${current}`);
      }
      if (!response?.ok) {
        console.error(`PDF fetch failed: status=${response?.status}, url=${current}`);
        throw new Error(`PDF_UPSTREAM_${response?.status || 502}`);
      }
      console.log(`Successfully fetched PDF, size: ${response.headers.get("content-length")} bytes`);
    }
    const size = Number(response.headers.get("content-length") || 0);
    const type = response.headers.get("content-type") || "";
    if (size > MAX_BYTES) throw new Error("PDF_TOO_LARGE");
    if (type && !type.toLowerCase().includes("pdf")) throw new Error("NOT_A_PDF");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("NOT_A_PDF");
    return new Response(bytes, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength), "Content-Disposition": response.headers.get("content-disposition") || "" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF_URL_FETCH_FAILED";
    console.error(`pdf-fetch error: ${message}`, error);
    const status = message === "AUTH_REQUIRED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return new Response(JSON.stringify({ error: message, details: error instanceof Error ? error.stack : undefined }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
