import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'
import { RustfsContainer } from '../src'

function createContainer() {
	const image = process.env.RUSTFS_IMAGE
	return image ? new RustfsContainer(image) : new RustfsContainer()
}

describe('RustfsContainer', () => {
	it('starts, creates a bucket, and round-trips an object', { timeout: 120_000 }, async () => {
		const rustfs = await createContainer().start()

		try {
			await rustfs.ensureBucket('test-bucket')

			const client = new S3Client({
				endpoint: rustfs.getEndpoint(),
				region: 'us-east-1',
				credentials: {
					accessKeyId: rustfs.accessKey,
					secretAccessKey: rustfs.secretKey,
				},
				forcePathStyle: true,
			})

			try {
				await client.send(
					new PutObjectCommand({
						Bucket: 'test-bucket',
						Key: 'hello.txt',
						Body: 'world',
						ContentType: 'text/plain',
					}),
				)

				const response = await client.send(
					new GetObjectCommand({
						Bucket: 'test-bucket',
						Key: 'hello.txt',
					}),
				)

				if (!response.Body) throw new Error('missing body')
				const body = await response.Body.transformToString()
				assert.equal(body, 'world')
			} finally {
				client.destroy()
			}
		} finally {
			await rustfs.stop()
		}
	})

	it('ensureBucket is idempotent', { timeout: 120_000 }, async () => {
		const rustfs = await createContainer().start()
		try {
			await rustfs.ensureBucket('idempotent')
			await rustfs.ensureBucket('idempotent')
		} finally {
			await rustfs.stop()
		}
	})
})
