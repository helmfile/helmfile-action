import * as core from '@actions/core'
import {
  arch,
  cacheDir,
  download,
  extract,
  platform,
  resloveCached,
  resolveLatest
} from './helpers'

export async function installHelmfile(version: string): Promise<void> {
  if (version === 'latest') {
    version = await resolveLatest('helmfile', 'helmfile')
  }

  let toolPath = await resloveCached('helmfile', version)
  if (toolPath) {
    core.info(`Found in cache @ ${toolPath}`)
    core.addPath(toolPath)
    return
  }
  core.info(`Attempting to download helmfile ${version}...`)
  const baseUrl = 'https://github.com/helmfile/helmfile/releases/download'
  const binVersion = version.replace(/^v/, '')
  const downloadUrl = `${baseUrl}/${version}/helmfile_${binVersion}_${platform}_${arch}.tar.gz`
  const downloadPath = await download(downloadUrl)
  const extractedPath = await extract(downloadPath)
  toolPath = await cacheDir(extractedPath, 'helmfile', version)
  core.addPath(toolPath)
}
