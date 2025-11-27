import * as core from '@actions/core';
import {exec, ExecOptions, getExecOutput} from '@actions/exec';
import {
  arch,
  cacheDir,
  download,
  extract,
  platform,
  resloveCached,
  resolveLatest
} from './helpers';

// Get the Helm major version (e.g., 3 or 4)
async function getHelmMajorVersion(): Promise<number> {
  try {
    const output = await getExecOutput('helm', ['version', '--short'], {
      silent: true
    });
    // Output format is like "v3.15.0+gc..." or "v4.0.0+g..."
    const versionMatch = output.stdout.match(/^v?(\d+)\./);
    if (versionMatch) {
      return parseInt(versionMatch[1], 10);
    }
  } catch (error) {
    core.warning(`Failed to get Helm version: ${error}`);
  }
  // Default to version 3 if we can't determine
  return 3;
}

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
  // Check Helm version to determine if --verify=false is needed (v4+)
  const helmMajorVersion = await getHelmMajorVersion();
  const verifyFlag = helmMajorVersion >= 4 ? '--verify=false ' : '';

  for (const plugin of plugins) {
    const pluginSpec = plugin.trim();
    let pluginUrl = pluginSpec;
    let version = '';

    // Parse plugin specification for version (format: url@version)
    const atIndex = pluginSpec.lastIndexOf('@');
    if (atIndex > 0) {
      const potentialVersion = pluginSpec.substring(atIndex + 1);
      // Check if the part after @ looks like a version (starts with v or is numeric)
      if (potentialVersion.match(/^v?\d+/)) {
        pluginUrl = pluginSpec.substring(0, atIndex);
        version = potentialVersion;
      }
    }

    let pluginStderr = '';

    const options: ExecOptions = {};
    options.ignoreReturnCode = true;
    options.listeners = {
      stderr: (data: Buffer) => {
        pluginStderr += data.toString();
      }
    };

    // Build the helm plugin install command (add --verify=false only for Helm v4+)
    let installCommand = `helm plugin install ${verifyFlag}${pluginUrl}`;
    if (version) {
      installCommand += ` --version ${version}`;
    }

    const eCode = await exec(installCommand, [], options);

    if (eCode == 0) {
      const versionInfo = version ? ` (version ${version})` : '';
      core.info(`Plugin ${pluginUrl}${versionInfo} installed successfully`);
      continue;
    }

    if (eCode == 1 && pluginStderr.includes('plugin already exists')) {
      const versionInfo = version ? ` (version ${version})` : '';
      core.info(`Plugin ${pluginUrl}${versionInfo} already exists`);
    } else {
      throw new Error(pluginStderr);
    }
  }

  await exec('helm plugin list');
}
