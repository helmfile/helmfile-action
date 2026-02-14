import * as core from '@actions/core';
import {exec, ExecOptions, getExecOutput} from '@actions/exec';
import * as http from '@actions/http-client';
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

// Import a GitHub user's GPG public key for Helm v4 plugin verification.
export async function importPluginGpgKey(owner: string): Promise<void> {
  try {
    const keyUrl = `https://github.com/${owner}.gpg`;
    core.info(`Importing GPG key for plugin verification from ${keyUrl}`);
    const httpClient = new http.HttpClient('helmfile-action');
    const response = await httpClient.get(keyUrl);
    const keyData = await response.readBody();
    await exec('gpg --import --batch', [], {
      input: Buffer.from(keyData)
    });
  } catch (error) {
    core.warning(`Failed to import GPG key for ${owner}: ${error}`);
  }
}

// Resolve Helm v4-compatible .tgz plugin assets from a GitHub release.
// Helm v4 plugins are distributed as .tgz archives with .prov provenance files.
// Returns download URLs for v4 plugin packages, or empty array if none found.
export async function resolveHelmV4PluginAssets(
  pluginUrl: string,
  version: string
): Promise<string[]> {
  const match = pluginUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return [];

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');

  try {
    const headers: Record<string, string> = {};
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const httpClient = new http.HttpClient('helmfile-action', [], {headers});

    const releaseUrl = version
      ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`
      : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    const response = await httpClient.getJson<{
      assets: {name: string; browser_download_url: string}[];
    }>(releaseUrl);
    const assets = response.result?.assets || [];

    // Helm v4 plugin packages have companion .prov (provenance) files.
    // Platform-specific binaries (e.g., helm-diff-linux-amd64.tgz) do not.
    const provNames = new Set(
      assets
        .filter(a => a.name.endsWith('.tgz.prov'))
        .map(a => a.name.replace(/\.prov$/, ''))
    );

    const v4PluginUrls = assets
      .filter(a => a.name.endsWith('.tgz') && provNames.has(a.name))
      .map(a => a.browser_download_url);

    return v4PluginUrls;
  } catch (error) {
    core.warning(
      `Failed to resolve Helm v4 plugin assets for ${pluginUrl}: ${error}`
    );
    return [];
  }
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
  // Check Helm version to determine install strategy
  const helmMajorVersion = await getHelmMajorVersion();

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

    // For Helm v4+, try installing from .tgz release assets first.
    // Helm v4 requires plugins to be distributed as .tgz packages to register
    // as subcommands. Installing from a repo URL registers them as "legacy"
    // plugins that don't expose subcommands (e.g., "helm secrets" won't work).
    if (helmMajorVersion >= 4) {
      const v4Assets = await resolveHelmV4PluginAssets(pluginUrl, version);
      if (v4Assets.length > 0) {
        core.info(
          `Found ${v4Assets.length} Helm v4 plugin package(s) for ${pluginUrl}`
        );
        // Import the plugin author's GPG key for signature verification
        const ownerMatch = pluginUrl.match(/github\.com\/([^/]+)\//);
        if (ownerMatch) {
          await importPluginGpgKey(ownerMatch[1]);
        }
        for (const assetUrl of v4Assets) {
          let assetStderr = '';
          const assetOptions: ExecOptions = {
            ignoreReturnCode: true,
            listeners: {
              stderr: (data: Buffer) => {
                assetStderr += data.toString();
              }
            }
          };

          const eCode = await exec(
            `helm plugin install ${assetUrl}`,
            [],
            assetOptions
          );

          if (eCode === 0) {
            core.info(`Installed Helm v4 plugin from ${assetUrl}`);
          } else if (assetStderr.includes('plugin already exists')) {
            core.info(`Plugin from ${assetUrl} already exists`);
          } else {
            throw new Error(
              `Failed to install Helm v4 plugin from ${assetUrl}: ${assetStderr}`
            );
          }
        }
        continue;
      }
      // No v4 .tgz packages found — fall back to legacy install with --verify=false
      core.info(
        `No Helm v4 plugin packages found for ${pluginUrl}, using legacy install`
      );
    }

    // Legacy install: Helm v3, or Helm v4 fallback for plugins without .tgz packages
    const verifyFlag = helmMajorVersion >= 4 ? '--verify=false ' : '';
    let pluginStderr = '';

    const options: ExecOptions = {};
    options.ignoreReturnCode = true;
    options.listeners = {
      stderr: (data: Buffer) => {
        pluginStderr += data.toString();
      }
    };

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
