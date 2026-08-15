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
  // Directly use fallback mirrors - they are reliable and tested
  // Fetching from sci-hub.shop is slow and unreliable
  const mirrors = getFallbackMirrors();
  console.log(`Using ${mirrors.length} fallback Sci-Hub mirrors`);
  return mirrors;
}

function getFallbackMirrors(): string[] {
  // Working Sci-Hub mirrors from parallel test (2026-08-15)
  // Sorted by response time (fastest first)
  return [
    // Top 5 fastest mirrors
    "http://sci-hub.mk",
    "https://sci-hub.al",
    "https://www.sci-hub.mk",
    "https://www.sci-hub.ee",
    "https://sci-hub.vg",
    // Additional working mirrors
    "http://sci-hub.vg",
    "https://sci-hub.mk",
    "http://sci-hub.al",
    "https://www.sci-hub.vg",
    "https://www.sci-hub.al"
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

    // Try each mirror sequentially without pre-testing
    for (const mirror of mirrors) {
      try {
        const scihubUrl = `${mirror}/${doi}`;
        console.log(`Attempting Sci-Hub mirror: ${mirror}`);

        const pageResponse = await fetch(scihubUrl, {
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            "Accept-Encoding": "gzip, deflate",
            "Cache-Control": "max-age=0",
            "Connection": "keep-alive"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!pageResponse.ok) {
          console.log(`Sci-Hub mirror ${mirror} returned status ${pageResponse.status}`);
          continue;
        }

        const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase();

        // If Sci-Hub directly returned a PDF
        if (contentType.includes("pdf")) {
          console.log(`✅ Got PDF directly from ${mirror}`);
          return pageResponse;
        }

        // Parse HTML to find PDF link
        const html = await pageResponse.text();
        console.log(`HTML length: ${html.length}`);

        // Check for protection
        if (html.includes("cf-browser-verification") ||
            html.includes("challenge-platform") ||
            html.includes("DDoS-Guard") ||
            html.includes("Just a moment")) {
          console.log(`❌ ${mirror} has protection, skipping`);
          continue;
        }

        if (contentType.includes("html")) {
          const pdfUrlObj = findPdfUrl(html, new URL(scihubUrl));

          if (pdfUrlObj) {
            console.log(`Found PDF URL: ${pdfUrlObj.toString()}`);

            const pdfResponse = await fetch(pdfUrlObj, {
              redirect: "follow",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/pdf",
                "Accept-Encoding": "gzip, deflate",
                "Referer": scihubUrl
              },
              signal: AbortSignal.timeout(10000)
            });

            if (pdfResponse.ok) {
              const pdfContentType = (pdfResponse.headers.get("content-type") || "").toLowerCase();
              if (pdfContentType.includes("pdf")) {
                console.log(`✅ Successfully fetched PDF from ${pdfUrlObj.toString()}`);
                return pdfResponse;
              } else {
                console.log(`⚠️ PDF URL returned non-PDF content-type: ${pdfContentType}`);
              }
            } else {
              console.log(`⚠️ PDF fetch failed with status: ${pdfResponse.status}`);
            }
          } else {
            console.log(`⚠️ No PDF URL found in HTML from ${mirror}`);
          }
        }
      } catch (error) {
        console.log(`Error with mirror ${mirror}:`, error instanceof Error ? error.message : String(error));
        continue;
      }
    }

    console.log(`All ${mirrors.length} mirrors failed`);
    return null;
  } catch (error) {
    console.log(`tryScihub error:`, error instanceof Error ? error.message : String(error));
    return null;
  }
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

    // Test Sci-Hub directly
    if (input.testScihub === true && input.url) {
      const doi = extractDoi(target(String(input.url)));
      if (!doi) {
        return new Response(JSON.stringify({ error: "Not a valid DOI URL" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      console.log(`Testing Sci-Hub for DOI: ${doi}`);

      try {
        const response = await tryScihub(doi);

        if (!response) {
          return new Response(JSON.stringify({
            error: "tryScihub returned null",
            doi
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        console.log(`Got response from tryScihub: status=${response.status}, type=${response.headers.get("content-type")}`);

        // Return the PDF directly
        return new Response(response.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/pdf",
            "Content-Length": response.headers.get("content-length") || "",
            "X-Debug": "direct-from-tryScihub"
          }
        });

      } catch (error) {
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          doi
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Detailed debug for DOI resolution
    if (input.debugDoi === true && input.url) {
      const doi = extractDoi(target(String(input.url)));
      if (!doi) {
        return new Response(JSON.stringify({ error: "Not a valid DOI URL" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const debugResults: any[] = [];
      const mirrors = await getAvailableScihubMirrors();

      // Test first 3 mirrors with full flow
      for (const mirror of mirrors.slice(0, 3)) {
        try {
          const scihubUrl = `${mirror}/${doi}`;
          const pageResponse = await fetch(scihubUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept-Encoding": "gzip, deflate",
              "Connection": "keep-alive"
            },
            signal: AbortSignal.timeout(10000)
          });

          const html = await pageResponse.text();
          const contentEncoding = pageResponse.headers.get("content-encoding");
          const pdfUrlObj = findPdfUrl(html, new URL(scihubUrl));

          let pdfStatus = null;
          let pdfContentType = null;
          let pdfSize = null;
          let pdfError = null;

          if (pdfUrlObj) {
            try {
              const pdfResponse = await fetch(pdfUrlObj, {
                redirect: "follow",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Accept": "application/pdf",
                  "Referer": scihubUrl
                },
                signal: AbortSignal.timeout(10000)
              });

              pdfStatus = pdfResponse.status;
              pdfContentType = pdfResponse.headers.get("content-type");
              pdfSize = pdfResponse.headers.get("content-length");
            } catch (err) {
              pdfError = err instanceof Error ? err.message : String(err);
            }
          }

          debugResults.push({
            mirror,
            status: pageResponse.status,
            contentType: pageResponse.headers.get("content-type"),
            contentEncoding,
            htmlLength: html.length,
            htmlPreview: html.substring(0, 500),
            pdfUrl: pdfUrlObj?.toString() || null,
            pdfStatus,
            pdfContentType,
            pdfSize,
            pdfError,
            hasCloudflare: html.includes("cf-browser-verification") || html.includes("challenge-platform")
          });
        } catch (error) {
          debugResults.push({
            mirror,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return new Response(JSON.stringify({
        doi,
        mirrors: mirrors.slice(0, 3),
        results: debugResults
      }, null, 2), {
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
    }
    // Skip rate limiting for anonymous users to avoid UUID type error
    // Anonymous requests are already limited by Supabase Edge Function quotas

    let current = target(String(input.url || ""));
    console.log(`Processing URL: ${current}, resolveDoi: ${resolveDoi}, userId: ${userId || 'anonymous'}`);
    if (resolveDoi && !isDoiUrl(current)) throw new Error("DOI_NOT_ALLOWED");

    const doi = extractDoi(current);
    let response: Response | undefined;

    // DOI resolution: directly use Sci-Hub (inline logic)
    if (resolveDoi && doi) {
      console.log(`Resolving DOI via Sci-Hub: ${doi}`);

      const mirrors = await getAvailableScihubMirrors();
      console.log(`Found ${mirrors.length} Sci-Hub mirrors`);

      // Try each mirror
      for (const mirror of mirrors.slice(0, 3)) {
        try {
          const scihubUrl = `${mirror}/${doi}`;
          console.log(`Trying mirror: ${mirror}`);

          const pageResponse = await fetch(scihubUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "text/html",
              "Accept-Encoding": "gzip, deflate"
            },
            signal: AbortSignal.timeout(10000)
          });

          if (!pageResponse.ok) {
            console.log(`Mirror ${mirror} returned ${pageResponse.status}`);
            continue;
          }

          const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase();
          if (contentType.includes("pdf")) {
            console.log(`✅ Got PDF directly from ${mirror}`);
            response = pageResponse;
            break;
          }

          const html = await pageResponse.text();
          const embedMatch = html.match(/<(?:embed|iframe)\b[^>]*src=["']([^"']+\.pdf[^"']*)["']/i);

          if (!embedMatch) {
            console.log(`No PDF URL found in ${mirror}`);
            continue;
          }

          let pdfUrl = embedMatch[1];
          if (pdfUrl.startsWith("//")) pdfUrl = `https:${pdfUrl}`;
          else if (pdfUrl.startsWith("/")) pdfUrl = new URL(pdfUrl, scihubUrl).toString();

          console.log(`Found PDF URL: ${pdfUrl}`);

          const pdfResponse = await fetch(pdfUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/pdf",
              "Accept-Encoding": "gzip, deflate",
              "Referer": scihubUrl
            },
            signal: AbortSignal.timeout(15000)
          });

          if (pdfResponse.ok && (pdfResponse.headers.get("content-type") || "").toLowerCase().includes("pdf")) {
            console.log(`✅ Successfully fetched PDF from ${mirror}`);
            response = pdfResponse;
            break;
          }

        } catch (error) {
          console.log(`Error with mirror ${mirror}:`, error instanceof Error ? error.message : String(error));
          continue;
        }
      }

      if (!response) {
        const mirrorLinks = mirrors.slice(0, 3).map(m => `${m}/${doi}`).join(', ');
        throw new Error(`DOI_PDF_NOT_AVAILABLE:${mirrorLinks}`);
      }

      console.log(`✅ DOI resolved successfully`);
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

    // Ensure we have a valid response
    if (!response) {
      console.error(`No response available after all attempts`);
      throw new Error("PDF_URL_FETCH_FAILED");
    }

    console.log(`Validating response: status=${response.status}, type=${response.headers.get("content-type")}`);

    // Validate response
    const size = Number(response.headers.get("content-length") || 0);
    const type = response.headers.get("content-type") || "";

    if (size > MAX_BYTES) throw new Error("PDF_TOO_LARGE");
    if (type && !type.toLowerCase().includes("pdf")) throw new Error("NOT_A_PDF");

    // For DOI resolution, stream the response directly without reading the full body
    // This avoids timeout issues with large PDFs
    if (resolveDoi) {
      console.log(`Streaming PDF response, size: ${size} bytes`);
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Length": response.headers.get("content-length") || "",
          "Content-Disposition": response.headers.get("content-disposition") || ""
        }
      });
    }

    // For direct PDF URLs, validate the PDF header
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("NOT_A_PDF");
    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": response.headers.get("content-disposition") || ""
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF_URL_FETCH_FAILED";
    console.error(`pdf-fetch error: ${message}`, error);
    const status = message === "AUTH_REQUIRED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return new Response(JSON.stringify({ error: message, details: error instanceof Error ? error.stack : undefined }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
