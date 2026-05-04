'use strict';

const GH_REPO_KEY = 'wmidi_gh_repo';
const RELEASE_TAG = 'continuous';

export function getStoredRepo() {
  return localStorage.getItem(GH_REPO_KEY) || '';
}

export function saveRepo(repo) {
  localStorage.setItem(GH_REPO_KEY, repo.trim());
}

// Extract short commit hash from version strings like:
//   "20250504-abc1234"  (Pi firmware format)
//   "2025-05-04-abc1234"  (asset name format)
function extractHash(v) {
  if (!v) return null;
  const parts = v.trim().split('-');
  return parts[parts.length - 1].toLowerCase();
}

async function fetchKernelAsset(repo) {
  const resp = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${RELEASE_TAG}`,
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  if (resp.status === 404) throw new Error(`No "${RELEASE_TAG}" release found in ${repo}`);
  if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
  const release = await resp.json();
  const asset = release.assets.find(a => a.name.endsWith('_kernel.zip'));
  if (!asset) throw new Error('No kernel asset found in latest release');
  const m = asset.name.match(/MiniDexed_\d+_(.+)_kernel\.zip/);
  const version = m ? m[1] : asset.name;
  return { asset, version };
}

async function unzipSingleFile(zipArrayBuffer) {
  const view = new DataView(zipArrayBuffer);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error('Not a valid ZIP file');
  const method         = view.getUint16(8,  true);
  const compressedSize = view.getUint32(18, true);
  const fnLen          = view.getUint16(26, true);
  const extLen         = view.getUint16(28, true);
  const dataStart      = 30 + fnLen + extLen;
  const compressed     = new Uint8Array(zipArrayBuffer, dataStart, compressedSize);

  if (method === 0) return new Blob([compressed]);
  if (method !== 8) throw new Error(`Unsupported ZIP compression method ${method}`);

  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();

  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new Blob([out]);
}

/**
 * @param {string} repo          - "owner/repo"
 * @param {string|null} piHash   - short hash reported by Pi (for up-to-date check)
 * @param {function} onStatus    - status string callback
 * @returns {{ blob: Blob, version: string } | { upToDate: true, version: string }}
 */
export async function checkAndDownloadKernel(repo, piHash, onStatus) {
  if (!repo) throw new Error('GitHub repo not set — enter it in Configuration');

  onStatus('Checking GitHub…');
  const { asset, version } = await fetchKernelAsset(repo);

  const remoteHash = extractHash(version);
  if (piHash && remoteHash && piHash === remoteHash) {
    return { upToDate: true, version };
  }

  const sizeKb = (asset.size / 1024).toFixed(0);
  onStatus(`Downloading ${version} (${sizeKb} KB)…`);

  const downloadUrl = `/proxy?url=${encodeURIComponent(asset.browser_download_url)}`;
  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();

  onStatus('Extracting kernel…');
  const blob = await unzipSingleFile(buf);
  return { blob, version };
}
