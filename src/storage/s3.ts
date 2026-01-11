import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { RaceData } from '../types.js';

// S3 client (will be initialized on first use)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return s3Client;
}

function getBucketName(): string {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME environment variable is required when using S3 storage');
  }
  return bucket;
}

export async function saveToS3(key: string, data: unknown): Promise<void> {
  const client = getS3Client();
  const bucket = getBucketName();
  
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  });

  await client.send(command);
  console.log(`Data saved to S3: s3://${bucket}/${key}`);
}

export async function loadFromS3<T>(key: string): Promise<T | null> {
  const client = getS3Client();
  const bucket = getBucketName();

  try {
    // Check if object exists
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    try {
      await client.send(headCommand);
    } catch (error: unknown) {
      // Object doesn't exist
      if ((error as { name?: string })?.name === 'NotFound' || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }

    // Get object
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(getCommand);
    
    if (!response.Body) {
      return null;
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString();
    return JSON.parse(bodyString) as T;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error loading from S3 (${key}): ${errorMessage}`);
    return null;
  }
}

export async function existsInS3(key: string): Promise<boolean> {
  const client = getS3Client();
  const bucket = getBucketName();

  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'NotFound' || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}