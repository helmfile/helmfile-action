import * as core from '@actions/core';
import {exec, ExecOptions} from '@actions/exec';
import {
  arch,
  cacheDir,
  download,
  extract,
  platform,
  resloveCached,
  resolveLatest
} from './helpers';

export async function installHelm(version: string): Promise<void> {
  if (version === 'latest') {
    version = await resolveLatest('helm', 'helm');
  }
  let toolPath = await resloveCached('helm', version);
  if (toolPath) {
    core.info(`Found in cache @ ${toolPath}`);
    core.addPath(toolPath);
    return;
  }
  core.info(`Attempting to download helm ${version}...`);
  const extension = platform === 'windows' ? 'zip' : 'tar.gz';
  const downloadUrl = `https://get.helm.sh/helm-${version}-${platform}-${arch}.${extension}`;
  const downloadPath = await download(downloadUrl);
  const extractedPath =
    platform === 'windows'
      ? await extract(downloadPath, 'zip')
      : await extract(downloadPath, 'tar');
  toolPath = await cacheDir(
    `${extractedPath}/${platform}-${arch}`,
    'helm',
    version
  );
  core.addPath(toolPath);
}

export async function installHelmPlugins(plugins: string[]): Promise<void> {
  for (const plugin of plugins) {
    let pluginStderr = '';

    const options: ExecOptions = {};
    options.ignoreReturnCode = true;
    options.listeners = {
      stderr: (data: Buffer) => {
        pluginStderr += data.toString();
      }
    };
    const eCode = await exec(
      `helm plugin install ${plugin.trim()}`,
      [],
      options
    );
    core.info(`eCode: ${eCode}`);
    core.info(`pluginStderr: ${pluginStderr}`);
    if (eCode == 1 && pluginStderr.includes('plugin already exists')) {
      core.info(`Plugin ${plugin} already exists`);
    } else {
      throw new Error(pluginStderr);
    }
    await exec('helm plugin list');
  }
}
