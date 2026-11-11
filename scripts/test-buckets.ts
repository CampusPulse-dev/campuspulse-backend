import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export async function prepareTestBuckets() {
  const client = new S3Client({
    endpoint: 'http://127.0.0.1:59000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'campuspulse-test', secretAccessKey: 'campuspulse-test-only' },
  });
  try {
    let ready = false;
    for (let i = 0; i < 30; i += 1) {
      try {
        await fetch('http://127.0.0.1:59000/minio/health/ready', {
          signal: AbortSignal.timeout(1000),
        }).then((r) => {
          if (!r.ok) throw new Error('Not ready');
        });
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!ready) throw new Error('Test MinIO did not become ready');
    for (const Bucket of ['campuspulse-test-media', 'campuspulse-test-private']) {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
        )
          throw error;
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    }
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: 'campuspulse-test-media',
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: ['arn:aws:s3:::campuspulse-test-media/*'],
            },
          ],
        }),
      }),
    );
    // Private bucket has no policy and new buckets are private by default.
  } finally {
    client.destroy();
  }
}
