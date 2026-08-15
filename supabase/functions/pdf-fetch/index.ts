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
  const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = `${htmlAttribute(tag, "name")} ${htmlAttribute(tag, "property")}`.toLowerCase();
    const href = htmlAttribute(tag, "content") || htmlAttribute(tag, "href");
    const type = htmlAttribute(tag, "type").toLowerCase();
    if (!href || (!/citation_pdf_url|pdf_url|bepress_citation_pdf_url|eprints\.document_url/.test(name) && type !== "application/pdf" && !/\.pdf(?:[?#]|$)/i.test(href))) continue;
    try { return target(new URL(href.replace(/&amp;/g, "&"), base).toString()); } catch { /* ignore invalid publisher metadata */ }
  }
  return null;
}
async function assertPublicDns(url: URL) {
  // Reject DNS rebinding targets as well as literal private addresses.
  const records = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = records.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length || addresses.some((address) => unsafeAddress(address))) throw new Error("URL_NOT_ALLOWED");
}

async function getAvailableScihubMirrors(): Promise<string[]> {
  try {
    const response = await fetch("https://www.sci-hub.shop/", {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) return [];

    const html = await response.text();

    // Extract Sci-Hub mirror links from the HTML
    // The page typically lists mirrors like: https://sci-hub.se, https://sci-hub.st, etc.
    const mirrors: string[] = [];
    const linkPattern = /https?:\/\/sci-?hub\.[a-z]{2,}/gi;
    const matches = html.match(linkPattern);

    if (matches) {
      const uniqueMirrors = [...new Set(matches)];
      // Validate and filter mirrors
      for (const mirror of uniqueMirrors) {
        try {
          const url = new URL(mirror);
          if (url.protocol === "https:" && !unsafeAddress(url.hostname)) {
            mirrors.push(mirror);
          }
        } catch {
          continue;
        }
      }
    }

    return mirrors;
  } catch {
    // Fallback to known stable mirrors if fetching fails
    return [
      "https://sci-hub.se",
      "https://sci-hub.st",
      "https://sci-hub.ru"
    ];
  }
}

async function tryScihub(doi: string): Promise<Response | null> {
  try {
    const mirrors = await getAvailableScihubMirrors();

    if (!mirrors.length) return null;

    // Try each mirror
    for (const mirror of mirrors) {
      try {
        const scihubUrl = `${mirror}/${doi}`;
        const scihubUrlObj = target(scihubUrl);
        await assertPublicDns(scihubUrlObj);

        const pageResponse = await fetch(scihubUrlObj, {
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          signal: AbortSignal.timeout(12000)
        });

        if (!pageResponse.ok) continue;

        const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase();

        // If Sci-Hub directly returned a PDF
        if (contentType.includes("pdf")) {
          const size = Number(pageResponse.headers.get("content-length") || 0);
          if (size > 0 && size <= MAX_BYTES) {
            return pageResponse;
          }
        }

        // Parse the HTML to find the PDF embed or download link
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

            await assertPublicDns(pdfUrl);

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
    const account = await user(req);
    await rateLimit(account.id, "pdf_fetch", 8);
    const input = await body(req);
    let current = target(String(input.url || ""));
    const resolveDoi = input.resolveDoi === true;
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
        // Try Unpaywall first (legal open access)
        response = await tryUnpaywall(doi);

        // If Unpaywall didn't work, try Sci-Hub mirrors
        if (!response) {
          response = await tryScihub(doi);
        }

        if (!response) throw new Error("DOI_PDF_NOT_FOUND");
      }
    } else {
      // Non-DOI URL: standard fetch
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        await assertPublicDns(current);
        response = await fetch(current, { redirect: "manual", headers: { Accept: "application/pdf" } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
        current = target(new URL(location, current).toString());
      }
      if (!response?.ok) throw new Error(`PDF_UPSTREAM_${response?.status || 502}`);
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
    const status = message === "AUTH_REQUIRED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
