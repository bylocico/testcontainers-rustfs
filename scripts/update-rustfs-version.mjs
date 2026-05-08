import { readFile, writeFile } from 'node:fs/promises'

const DOCKER_HUB_TAGS_URL =
	'https://registry.hub.docker.com/v2/repositories/rustfs/rustfs/tags?page_size=100'
const PACKAGE_JSON = new URL('../package.json', import.meta.url)
const CONTAINER_SOURCE = new URL('../src/rustfs-container.ts', import.meta.url)
const README = new URL('../README.md', import.meta.url)
const args = new Set(process.argv.slice(2))
const versionArgIndex = process.argv.indexOf('--version')
const requestedVersion =
	versionArgIndex === -1 ? null : process.argv[versionArgIndex + 1]

function parseSemver(version) {
	const match = version.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/,
	)
	if (!match) return null

	return {
		version,
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split('.') ?? [],
	}
}

function comparePrerelease(left, right) {
	if (left.length === 0 && right.length === 0) return 0
	if (left.length === 0) return 1
	if (right.length === 0) return -1

	const length = Math.max(left.length, right.length)
	for (let i = 0; i < length; i++) {
		const a = left[i]
		const b = right[i]
		if (a === undefined) return -1
		if (b === undefined) return 1
		if (a === b) continue

		const aNumber = /^\d+$/.test(a) ? Number(a) : null
		const bNumber = /^\d+$/.test(b) ? Number(b) : null
		if (aNumber !== null && bNumber !== null) return aNumber - bNumber
		if (aNumber !== null) return -1
		if (bNumber !== null) return 1
		return a.localeCompare(b)
	}

	return 0
}

function compareSemver(left, right) {
	for (const key of ['major', 'minor', 'patch']) {
		const delta = left[key] - right[key]
		if (delta !== 0) return delta
	}
	return comparePrerelease(left.prerelease, right.prerelease)
}

async function fetchRustfsTags() {
	const tags = []
	let next = DOCKER_HUB_TAGS_URL

	while (next) {
		const response = await fetch(next)
		if (!response.ok) {
			throw new Error(
				`Docker Hub tag query failed with ${response.status} ${response.statusText}`,
			)
		}

		const payload = await response.json()
		for (const result of payload.results ?? []) {
			if (typeof result.name === 'string') tags.push(result.name)
		}
		next = payload.next
	}

	return tags
}

function latestVersionTag(tags) {
	const versions = tags
		.map(parseSemver)
		.filter((version) => version !== null)
		.sort(compareSemver)

	return versions.at(-1)
}

function versionTags(tags) {
	return tags
		.filter((tag) => !tag.endsWith('-glibc'))
		.map(parseSemver)
		.filter((version) => version !== null)
		.sort(compareSemver)
}

function replaceVersion(text, currentVersion, nextVersion) {
	return text.split(currentVersion).join(nextVersion)
}

const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'))
const current = parseSemver(packageJson.version)
if (!current) {
	throw new Error(`Package version is not a RustFS-compatible semver: ${packageJson.version}`)
}

const tags = await fetchRustfsTags()
const versions = versionTags(tags)
const latest = versions.at(-1)
if (!latest) throw new Error('No versioned rustfs/rustfs Docker tags found')

if (args.has('--list-newer')) {
	const newerVersions = versions
		.filter((version) => compareSemver(version, current) > 0)
		.map((version) => version.version)
	console.log(JSON.stringify(newerVersions))
	process.exit(0)
}

const target = requestedVersion ? parseSemver(requestedVersion) : latest
if (!target) throw new Error(`Invalid requested RustFS version: ${requestedVersion}`)
if (!versions.some((version) => version.version === target.version)) {
	throw new Error(`rustfs/rustfs:${target.version} was not found on Docker Hub`)
}

if (target.version === current.version) {
	console.log(`Already targeting RustFS Docker tag: ${current.version}`)
	process.exit(0)
}

packageJson.version = target.version
await writeFile(PACKAGE_JSON, `${JSON.stringify(packageJson, null, '\t')}\n`)

const source = await readFile(CONTAINER_SOURCE, 'utf8')
await writeFile(
	CONTAINER_SOURCE,
	replaceVersion(source, current.version, target.version),
)

const readme = await readFile(README, 'utf8')
await writeFile(README, replaceVersion(readme, current.version, target.version))

console.log(`Updated RustFS target ${current.version} -> ${target.version}`)
