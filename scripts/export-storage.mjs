#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// export-storage.mjs  —  Download all files from Supabase Storage bucket
//                         "ncr-attachments" to a local directory
// ─────────────────────────────────────────────────────────────────────────────
//
// ต้องการ: Node.js 18+  (มี global fetch built-in)
//
// วิธีใช้:
//   node scripts/export-storage.mjs
//
// ต้องมีไฟล์ .env.local ที่ root ของโปรเจกต์ พร้อม:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// ไฟล์จะถูกดาวน์โหลดไปที่:
//   scripts/exports/storage_YYYYMMDD_HHMMSS/
//   โดยรักษา directory structure เดิม: {ncrId}/{attachmentId}/{filename}
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadDotEnv() {
  const envPath = join(__dirname, '..', '.env.local');
  try {
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
    console.log('✓ Loaded env from .env.local');
  } catch {
    // No .env.local — rely on environment variables already set
  }
}

loadDotEnv();

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = 'ncr-attachments';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const STORAGE_API = `${SUPABASE_URL}/storage/v1`;
const AUTH_HEADER = { Authorization: `Bearer ${SERVICE_KEY}` };

// ── Output directory ─────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15); // YYYYMMDDTHHmmss
const OUTPUT_DIR = join(__dirname, 'exports', `storage_${ts}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * List all items under a Storage prefix.
 * Items with id = null are "folders" (virtual directories).
 * Items with id = string are actual files.
 * Paginates automatically if bucket has more than 1000 items per level.
 */
async function listPrefix(prefix = '') {
  const items = [];
  let offset  = 0;
  const LIMIT = 1000;

  while (true) {
    const res = await fetch(`${STORAGE_API}/object/list/${BUCKET}`, {
      method:  'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        prefix,
        limit:  LIMIT,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Storage list failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    items.push(...data);
    if (data.length < LIMIT) break;
    offset += LIMIT;
  }

  return items;
}

/**
 * Recursively collect every file path in the bucket.
 * Returns an array of full storage paths, e.g.:
 *   ["ncrId/attachId/photo.jpg", "ncrId/attachId/doc.pdf", ...]
 */
async function collectAllFiles(prefix = '') {
  const entries = await listPrefix(prefix);
  const files   = [];

  for (const entry of entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.id) {
      // It's a file
      files.push(fullPath);
    } else {
      // It's a virtual folder — recurse
      const nested = await collectAllFiles(fullPath);
      files.push(...nested);
    }
  }

  return files;
}

/**
 * Download a single file from Storage using the authenticated endpoint.
 * Returns a Buffer.
 */
async function downloadFile(storagePath) {
  const url = `${STORAGE_API}/object/authenticated/${BUCKET}/${storagePath}`;
  const res = await fetch(url, { headers: AUTH_HEADER });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${storagePath}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 Listing all files in bucket '${BUCKET}'...`);

  let allFiles;
  try {
    allFiles = await collectAllFiles();
  } catch (err) {
    console.error(`❌  Failed to list bucket: ${err.message}`);
    process.exit(1);
  }

  if (allFiles.length === 0) {
    console.log('ℹ️   Bucket is empty — nothing to export.');
    process.exit(0);
  }

  console.log(`📁 Found ${allFiles.length} file(s)`);
  console.log(`📂 Output directory: ${OUTPUT_DIR}\n`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  let success = 0;
  let failed  = 0;
  let totalBytes = 0;

  for (const filePath of allFiles) {
    const localPath = join(OUTPUT_DIR, filePath);
    mkdirSync(dirname(localPath), { recursive: true });

    try {
      const buf = await downloadFile(filePath);
      writeFileSync(localPath, buf);
      totalBytes += buf.length;
      success++;
      process.stdout.write(`  ✓ ${filePath} (${(buf.length / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      failed++;
      process.stderr.write(`  ✗ ${filePath}: ${err.message}\n`);
    }
  }

  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ Done: ${success} downloaded  |  ${failed} failed  |  ${totalMB} MB total`);
  console.log(`📂 Saved to: ${OUTPUT_DIR}`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('\n❌ Unexpected error:', err);
  process.exit(1);
});
