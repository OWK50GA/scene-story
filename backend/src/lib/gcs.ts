/**
 * gcs.ts
 *
 * Thin wrapper around @google-cloud/storage for screenplay file retention.
 *
 * uploadScreenplay uploads the raw screenplay buffer to GCS and returns
 * the public HTTPS URL. The object key is deterministic:
 *
 *   {universeId}/{storyUnitId}/original.{ext}
 *
 * This ensures re-ingestion of the same unit overwrites the previous file
 * rather than accumulating orphans.
 *
 * Authentication: uses Application Default Credentials (ADC). On Cloud Run
 * this is the service account attached to the revision. Locally it uses
 * GOOGLE_APPLICATION_CREDENTIALS from .env.
 *
 * If GCS_BUCKET is not configured the function throws — callers must guard
 * with a config check before calling.
 */

import { Storage } from "@google-cloud/storage";
import { config } from "../config/index.js";

const storage = new Storage({
  projectId: config.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: config.GOOGLE_APPLICATION_CREDENTIALS,
});

/**
 * uploadScreenplay
 *
 * Uploads the screenplay buffer to GCS.
 *
 * @param buffer      Raw file bytes from multer memory storage.
 * @param universeId  UUID of the universe — used as top-level path segment.
 * @param storyUnitId UUID of the story unit — used as second path segment.
 * @param ext         File extension without dot, e.g. "txt", "pdf", "fountain".
 * @returns           The public HTTPS URL of the uploaded object.
 * @throws            If GCS_BUCKET is not configured or the upload fails.
 */
export async function uploadScreenplay(
  buffer: Buffer,
  universeId: string,
  storyUnitId: string,
  ext: string,
): Promise<string> {
  const bucket = config.GCS_BUCKET;
  if (!bucket) {
    throw new Error("GCS_BUCKET is not configured — cannot upload screenplay.");
  }

  const objectKey = `${universeId}/${storyUnitId}/original.${ext}`;

  const file = storage.bucket(bucket).file(objectKey);

  await file.save(buffer, {
    contentType: extToMimeType(ext),
    metadata: {
      universeId,
      storyUnitId,
      uploadedAt: new Date().toISOString(),
    },
  });

  // Return the standard GCS HTTPS URL. The bucket must have uniform bucket-level
  // access or the object must have allUsers:objectViewer for this URL to be public.
  // For private access, generate a signed URL here instead.
  return `https://storage.googleapis.com/${bucket}/${objectKey}`;
}

function extToMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case "pdf": return "application/pdf";
    case "fountain": return "text/plain";
    default: return "text/plain";
  }
}
