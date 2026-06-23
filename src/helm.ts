import * as core from '@actions/core';
import {exec, ExecOptions, getExecOutput} from '@actions/exec';
import * as http from '@actions/http-client';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  arch,
  cacheDir,
  download,
  extract,
  platform,
  resloveCached,
  resolveLatest
} from './helpers';

// Parse owner and repo from a GitHub URL using proper URL parsing.
// Returns null for non-GitHub URLs or URLs without a valid owner/repo path.
function parseGitHubRepo(
  urlString: string
): {owner: string; repo: string} | null {
  try {
    const url = new URL(urlString);
    if (url.hostname !== 'github.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, '');
    // Validate against GitHub's allowed characters to reject malformed URLs
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) {
      return null;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;
    return {owner, repo};
  } catch {
    return null;
  }
}

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
// After importing, exports keys to pubring.gpg (legacy format) because
// Helm v4 looks for the old GnuPG v1 keyring file, not the modern pubring.kbx.
export async function importPluginGpgKey(owner: string): Promise<void> {
  try {
    const keyUrl = `https://github.com/${owner}.gpg`;
    core.info(`Importing GPG key for plugin verification from ${keyUrl}`);
    const httpClient = new http.HttpClient('helmfile-action');
    const response = await httpClient.get(keyUrl);
    const statusCode = response.message.statusCode ?? 0;
    if (statusCode < 200 || statusCode >= 300) {
      core.warning(
        `Failed to download GPG key for ${owner} from ${keyUrl}: HTTP ${statusCode}`
      );
      return;
    }
    const keyData = await response.readBody();
    await exec('gpg', ['--import', '--batch'], {
      input: Buffer.from(keyData)
    });
    // Helm v4 reads pubring.gpg (GnuPG v1 format), but modern gpg stores
    // keys in pubring.kbx (v2 format). Export the keyring to the legacy file.
    const gnupgHome =
      process.env.GNUPGHOME || path.join(os.homedir(), '.gnupg');
    const pubringPath = path.join(gnupgHome, 'pubring.gpg');
    await exec('gpg', [
      '--batch',
      '--yes',
      '--export',
      '--output',
      pubringPath
    ]);
  } catch (error) {
    core.warning(`Failed to import GPG key for ${owner}: ${error}`);
  }
}

async function getHelmPluginsDir(): Promise<string | null> {
  const pluginsDir = process.env.HELM_PLUGINS?.trim();
  if (pluginsDir) return pluginsDir;

  try {
    const output = await getExecOutput('helm', ['env', 'HELM_PLUGINS'], {
      silent: true
    });
    return output.stdout.trim().replace(/^"(.*)"$/, '$1') || null;
  } catch (error) {
    core.warning(`Failed to determine Helm plugin directory: ${error}`);
    return null;
  }
}

async function cleanupPartialPluginInstall(assetUrl: string): Promise<void> {
  const pluginsDir = await getHelmPluginsDir();
  if (!pluginsDir) return;

  let assetName = '';
  try {
    assetName = path.basename(decodeURIComponent(new URL(assetUrl).pathname));
  } catch {
    assetName = path.basename(
      decodeURIComponent(assetUrl).split('/').pop() ?? ''
    );
  }

  if (!assetName.toLowerCase().endsWith('.tgz')) return;

  try {
    await fs.rm(path.join(pluginsDir, assetName.replace(/\.tgz$/i, '')), {
      recursive: true,
      force: true
    });
  } catch (error) {
    core.warning(
      `Failed to clean up partial plugin install for ${assetName}: ${error}`
    );
  }
}

// Helm v4 emits this error (via logrus on stderr) when two plugin directories
// declare the same plugin name. This happens when a plugin was already installed
// under one directory (e.g. `helmfile init` installs "diff" into helm-diff/) and
// a subsequent .tgz install extracts under an asset-named directory
// (helm-diff-<os>-<arch>/). The install exits 0 but leaves a broken plugins dir.
function isDuplicatePluginError(output: string): boolean {
  return /plugins claim the name/i.test(output);
}

// Classify the result of a `helm plugin install` attempt based on exit code and
// stderr, so the v4 .tgz install loop can react consistently across retries.
type PluginInstallResult =
  | 'installed'
  | 'duplicate'
  | 'exists'
  | 'verify-failed'
  | 'failed';

function classifyPluginInstall(
  eCode: number,
  stderr: string
): PluginInstallResult {
  if (isDuplicatePluginError(stderr)) return 'duplicate';
  if (eCode === 0) return 'installed';
  if (stderr.includes('plugin already exists')) return 'exists';
  if (
    stderr.includes('verification') ||
    stderr.includes('pubring') ||
    stderr.includes('openpgp')
  ) {
    return 'verify-failed';
  }
  return 'failed';
}

const PLATFORM_ALIASES: Record<string, string[]> = {
  linux: ['linux'],
  darwin: ['macos', 'darwin'],
  windows: ['windows', 'win']
};

const ARCH_ALIASES: Record<string, string[]> = {
  amd64: ['amd64', 'x86_64'],
  arm64: ['arm64', 'aarch64'],
  arm: ['armv6', 'armv7', 'arm']
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAssetTokenRegex(patterns: string[]): RegExp {
  return new RegExp(
    `(?:^|[._-])(?:${patterns.map(escapeRegex).join('|')})(?=$|[._-])`,
    'i'
  );
}

export function filterPlatformAsset<T extends {name: string}>(
  assets: T[],
  runnerPlatform?: string,
  runnerArch?: string
): T[] {
  const p =
    runnerPlatform ?? (os.platform() === 'win32' ? 'windows' : os.platform());
  const a = runnerArch
    ? runnerArch === 'x64'
      ? 'amd64'
      : runnerArch
    : os.arch() === 'x64'
      ? 'amd64'
      : os.arch();

  const platformPatterns = PLATFORM_ALIASES[p] || [p];
  const archPatterns = ARCH_ALIASES[a] || [a];

  const platformRegex = buildAssetTokenRegex(platformPatterns);
  const archRegex = buildAssetTokenRegex(archPatterns);

  const matched = assets.filter(asset => {
    const baseName = asset.name.replace(/\.tgz$/i, '');
    return platformRegex.test(baseName) && archRegex.test(baseName);
  });

  return matched.length > 0 ? matched : assets;
}

// Resolve Helm v4-compatible .tgz plugin assets from a GitHub release.
// Helm v4 plugins are distributed as .tgz archives with .prov provenance files.
// Returns download URLs for v4 plugin packages, or empty array if none found.
export async function resolveHelmV4PluginAssets(
  pluginUrl: string,
  version: string
): Promise<string[]> {
  const parsed = parseGitHubRepo(pluginUrl);
  if (!parsed) return [];

  const {owner, repo} = parsed;

  try {
    const headers: Record<string, string> = {};
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    } else {
      core.debug(
        'GITHUB_TOKEN is not set. GitHub API requests may be rate-limited. ' +
          'Set the GITHUB_TOKEN environment variable to increase the rate limit.'
      );
    }
    const httpClient = new http.HttpClient('helmfile-action', [], {headers});

    // Build candidate release URLs. When a version is specified, try both
    // "vX.Y.Z" and "X.Y.Z" tag formats since repos may use either convention.
    const releaseUrls: string[] = [];
    if (version) {
      const baseVersion = version.replace(/^v/, '');
      releaseUrls.push(
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/v${baseVersion}`
      );
      releaseUrls.push(
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/${baseVersion}`
      );
    } else {
      releaseUrls.push(
        `https://api.github.com/repos/${owner}/${repo}/releases/latest`
      );
    }

    let lastError: unknown;
    for (const releaseUrl of releaseUrls) {
      let response;
      try {
        response = await httpClient.getJson<{
          assets: {name: string; browser_download_url: string}[];
        }>(releaseUrl);
      } catch (error) {
        // Tag not found — try next candidate
        lastError = error;
        continue;
      }
      // Request succeeded — clear any previous error from alternate tag formats
      lastError = undefined;
      const assets = response.result?.assets || [];

      // Helm v4 plugin packages have companion .prov (provenance) files.
      const provNames = new Set(
        assets
          .filter(a => a.name.endsWith('.tgz.prov'))
          .map(a => a.name.replace(/\.prov$/, ''))
      );

      const v4PluginAssets = assets.filter(
        a => a.name.endsWith('.tgz') && provNames.has(a.name)
      );

      if (v4PluginAssets.length > 0) {
        return filterPlatformAsset(v4PluginAssets).map(
          a => a.browser_download_url
        );
      }
    }

    if (lastError) {
      core.warning(
        `Failed to resolve Helm v4 plugin assets for ${pluginUrl}: ${lastError}`
      );
    }
    return [];
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
      // If the URL already points to a .tgz archive, install it directly
      // instead of querying the releases API (which could resolve different assets).
      const v4Assets = pluginUrl.endsWith('.tgz')
        ? [pluginUrl]
        : await resolveHelmV4PluginAssets(pluginUrl, version);
      if (v4Assets.length > 0) {
        core.info(
          `Found ${v4Assets.length} Helm v4 plugin package(s) for ${pluginUrl}`
        );
        // Import the plugin author's GPG key for signature verification
        const ownerParsed = parseGitHubRepo(pluginUrl);
        if (ownerParsed) {
          await importPluginGpgKey(ownerParsed.owner);
        }
        let installed = false;
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

          let eCode = await exec(
            'helm',
            ['plugin', 'install', assetUrl],
            assetOptions
          );

          let result = classifyPluginInstall(eCode, assetStderr);
          let unverified = false;

          // Verification failed (e.g., GPG key missing/wrong) — retry with
          // --verify=false. The .tgz still registers as a proper v4 plugin.
          if (result === 'verify-failed') {
            core.warning(
              `Verification failed for ${assetUrl}, retrying with --verify=false`
            );
            await cleanupPartialPluginInstall(assetUrl);
            assetStderr = '';
            eCode = await exec(
              'helm',
              ['plugin', 'install', '--verify=false', assetUrl],
              assetOptions
            );
            result = classifyPluginInstall(eCode, assetStderr);
            unverified = result === 'installed';
          }

          if (result === 'installed') {
            const suffix = unverified ? ' (unverified)' : '';
            core.info(`Installed Helm v4 plugin from ${assetUrl}${suffix}`);
            installed = true;
          } else if (result === 'duplicate') {
            // The plugin was already installed under a different directory
            // (e.g. by `helmfile init`). Remove the duplicate directory we just
            // created from the .tgz so the plugins dir is not left broken.
            core.info(
              `Plugin from ${assetUrl} already installed; removing duplicate directory`
            );
            await cleanupPartialPluginInstall(assetUrl);
            installed = true;
          } else if (result === 'exists') {
            core.info(`Plugin from ${assetUrl} already exists`);
            installed = true;
          } else {
            await cleanupPartialPluginInstall(assetUrl);
            core.warning(
              `Failed to install Helm v4 plugin from ${assetUrl}: ${assetStderr}`
            );
          }

          if (installed) {
            break;
          }
        }
        if (installed) {
          continue;
        }
        core.info(
          `All .tgz installs failed for ${pluginUrl}, falling back to legacy install`
        );
      } else {
        // No v4 .tgz packages found — fall back to legacy install with --verify=false
        core.info(
          `No Helm v4 plugin packages found for ${pluginUrl}, using legacy install`
        );
      }
    }

    // Legacy install: Helm v3, or Helm v4 fallback for plugins without .tgz packages
    let pluginStderr = '';

    const options: ExecOptions = {};
    options.ignoreReturnCode = true;
    options.listeners = {
      stderr: (data: Buffer) => {
        pluginStderr += data.toString();
      }
    };

    const installArgs = ['plugin', 'install'];
    if (helmMajorVersion >= 4) {
      installArgs.push('--verify=false');
    }
    installArgs.push(pluginUrl);
    if (version) {
      installArgs.push('--version', version);
    }

    const eCode = await exec('helm', installArgs, options);

    if (eCode === 0) {
      const versionInfo = version ? ` (version ${version})` : '';
      core.info(`Plugin ${pluginUrl}${versionInfo} installed successfully`);
      continue;
    }

    if (eCode === 1 && pluginStderr.includes('plugin already exists')) {
      const versionInfo = version ? ` (version ${version})` : '';
      core.info(`Plugin ${pluginUrl}${versionInfo} already exists`);
    } else {
      throw new Error(pluginStderr);
    }
  }

  await exec('helm', ['plugin', 'list']);
}
