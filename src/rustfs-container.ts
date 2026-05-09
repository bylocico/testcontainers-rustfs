import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import {
	AbstractStartedContainer,
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from 'testcontainers'

export const DEFAULT_RUSTFS_VERSION = '1.0.0-beta.2'
export const DEFAULT_IMAGE = `rustfs/rustfs:${DEFAULT_RUSTFS_VERSION}`
export const DEFAULT_USER = 'rustfsadmin'
export const DEFAULT_PASSWORD = 'rustfsadmin'
const API_PORT = 9000

export class RustfsContainer extends GenericContainer {
	private rootUser: string = DEFAULT_USER
	private rootPassword: string = DEFAULT_PASSWORD

	constructor(image: string = DEFAULT_IMAGE) {
		super(image)
		this.withExposedPorts(API_PORT)
			.withEnvironment({
				RUSTFS_ROOT_USER: this.rootUser,
				RUSTFS_ROOT_PASSWORD: this.rootPassword,
			})
			.withWaitStrategy(
				Wait.forHttp('/', API_PORT).forStatusCodeMatching((c) => c < 500),
			)
			.withStartupTimeout(60_000)
	}

	withCredentials(user: string, password: string): this {
		this.rootUser = user
		this.rootPassword = password
		this.withEnvironment({
			RUSTFS_ROOT_USER: user,
			RUSTFS_ROOT_PASSWORD: password,
		})
		return this
	}

	override async start(): Promise<StartedRustfsContainer> {
		const started = await super.start()
		return new StartedRustfsContainer(started, this.rootUser, this.rootPassword)
	}
}

export class StartedRustfsContainer extends AbstractStartedContainer {
	constructor(
		startedTestContainer: StartedTestContainer,
		public readonly accessKey: string,
		public readonly secretKey: string,
	) {
		super(startedTestContainer)
	}

	getPort(): number {
		return this.getMappedPort(API_PORT)
	}

	getEndpoint(): string {
		return `http://${this.getHost()}:${this.getPort()}`
	}

	async ensureBucket(name: string): Promise<void> {
		const client = new S3Client({
			endpoint: this.getEndpoint(),
			region: 'us-east-1',
			credentials: {
				accessKeyId: this.accessKey,
				secretAccessKey: this.secretKey,
			},
			forcePathStyle: true,
		})
		try {
			await client.send(new CreateBucketCommand({ Bucket: name }))
		} catch (e: unknown) {
			const err = e as { name?: string; Code?: string }
			const code = err.name ?? err.Code
			if (
				code !== 'BucketAlreadyOwnedByYou' &&
				code !== 'BucketAlreadyExists'
			) {
				throw e
			}
		} finally {
			client.destroy()
		}
	}
}
