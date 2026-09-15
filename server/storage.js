import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { decryptSecret, getSetting } from './settings.js';

export async function storageConfiguration() {
  const value = await getSetting('storage');
  return value || { provider: 'local' };
}

function client(configuration) {
  return new S3Client({
    region: configuration.region || 'us-east-1',
    endpoint: configuration.endpoint || undefined,
    forcePathStyle: Boolean(configuration.forcePathStyle),
    credentials: configuration.accessKey ? {
      accessKeyId: configuration.accessKey,
      secretAccessKey: decryptSecret(configuration.encryptedSecretKey)
    } : undefined
  });
}

export async function testStorage(configuration) {
  if (configuration.provider === 'local') return;
  await client(configuration).send(new HeadBucketCommand({ Bucket: configuration.bucket }));
}

export async function putStoredFile(configuration, localPath, key, contentType) {
  const stat = await fs.promises.stat(localPath);
  await client(configuration).send(new PutObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentLength: stat.size,
    ContentType: contentType
  }));
}

export async function deleteStoredFiles(configuration, keys) {
  const filtered = [...new Set(keys.filter(Boolean))];
  if (!filtered.length) return;
  const result = await client(configuration).send(new DeleteObjectsCommand({
    Bucket: configuration.bucket,
    Delete: { Objects: filtered.map((Key) => ({ Key })), Quiet: true }
  }));
  if (result.Errors?.length) throw new Error('Some files could not be deleted from S3. Check bucket permissions.');
}

export async function downloadStoredFile(configuration, key, destination) {
  const result = await client(configuration).send(new GetObjectCommand({ Bucket: configuration.bucket, Key: key }));
  await pipeline(result.Body, fs.createWriteStream(destination));
}

export async function streamStoredFile(configuration, key, request, response, contentType, filename) {
  const result = await client(configuration).send(new GetObjectCommand({
    Bucket: configuration.bucket,
    Key: key,
    Range: request.get('Range') || undefined
  }));
  response.status(result.ContentRange ? 206 : 200);
  response.type(contentType);
  response.set('Accept-Ranges', 'bytes');
  response.set('Content-Disposition', `inline; filename="${filename.replace(/["\\]/g, '')}"`);
  if (result.ContentLength != null) response.set('Content-Length', String(result.ContentLength));
  if (result.ContentRange) response.set('Content-Range', result.ContentRange);
  await pipeline(result.Body, response);
}
