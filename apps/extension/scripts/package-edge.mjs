import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import JSZip from "jszip";

const appRoot = new URL("..", import.meta.url).pathname;
const buildDir = join(appRoot, "dist");
const archivePath = join(appRoot, "../../dist/shidea-edge-extension.zip");
const publicArchivePath = join(appRoot, "public/downloads/shidea-edge-extension.zip");
const archive = new JSZip();

async function addDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // The archive itself is copied into public/downloads before the second build.
    // Excluding it prevents recursively packaging a previous extension archive.
    if (entry.name === "downloads" && directory === buildDir) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) await addDirectory(absolutePath);
    else if (entry.isFile()) archive.file(relative(buildDir, absolutePath), await readFile(absolutePath));
  }
}

await addDirectory(buildDir);
const data = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
await mkdir(dirname(archivePath), { recursive: true });
await mkdir(dirname(publicArchivePath), { recursive: true });
await Promise.all([writeFile(archivePath, data), writeFile(publicArchivePath, data)]);
