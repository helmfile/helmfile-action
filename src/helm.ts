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

// A listing of the Helm plugins directory, taken before/after a
// `helm plugin install` attempt to detect what the attempt changed.
type PluginsDirSnapshot = {dir: string | null; entries: string[]};

async function snapshotPluginsDir(): Promise<PluginsDirSnapshot> {
  const dir = await getHelmPluginsDir();
  if (!dir) return {dir: null, entries: []};
  try {
    return {dir, entries: await fs.readdir(dir)};
  } catch (error) {
    core.warning(`Failed to list Helm plugin directory ${dir}: ${error}`);
    return {dir, entries: []};
  }
}

// Read the declared plugin name from a plugin directory's metadata file.
// Helm v4 uses metadata.yaml, while Helm v3/legacy plugins use plugin.yaml.
async function readPluginName(pluginDir: string): Promise<string | null> {
  for (const file of ['metadata.yaml', 'plugin.yaml']) {
    try {
      const content = await fs.readFile(path.join(pluginDir, file), 'utf8');
      const match = content.match(/^name:\s*['"]?([^\s'"]+)['"]?/m);
      if (match) return match[1];
    } catch {
      // file missing — try the next candidate
    }
  }
  return null;
}

// Remove plugin directories that a failed `helm plugin install` attempt left
// behind, so retries and the legacy fallback start from a clean state. Helm
// extracts an asset into a directory named after the archive's root folder
// (e.g. "diff"), not after the asset file name, so detect the new directories
// by diffing directory listings taken before and after the attempt.
async function removeCreatedPluginDirs(
  snapshot: PluginsDirSnapshot,
  reason: string
): Promise<void> {
  const {dir, entries} = snapshot;
  if (!dir) return;

  let after: string[] = [];
  try {
    after = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of after.filter(e => !entries.includes(e))) {
    try {
      await fs.rm(path.join(dir, entry), {recursive: true, force: true});
      core.info(`Removed partial plugin directory ${entry} (${reason})`);
    } catch (error) {
      core.warning(
        `Failed to remove partial plugin directory ${entry}: ${error}`
      );
    }
  }
}

// After a successful .tgz install, Helm may silently leave a second directory
// declaring the same plugin name as a pre-existing one (it does not fail the
// install; it only errors later at `helm plugin list`). This happens e.g. when
// `helmfile init` already installed a plugin: helmfile extracts the archive
// under the repo name ("helm-diff/") while a Helm v4 .tgz asset extracts under
// the plugin name ("diff/"), and both metadata files declare name "diff".
// Keep the freshly installed package — the release this action resolved, i.e.
// the latest version — and remove the pre-existing duplicate so exactly one
// directory remains per plugin name.
async function removePreexistingDuplicate(
  snapshot: PluginsDirSnapshot
): Promise<boolean> {
  const {dir, entries} = snapshot;
  if (!dir) return false;

  let after: string[] = [];
  try {
    after = await fs.readdir(dir);
  } catch {
    return false;
  }
  const created = after.filter(e => !entries.includes(e));

  for (const createdEntry of created) {
    const createdName = await readPluginName(path.join(dir, createdEntry));
    if (!createdName) continue;

    for (const priorEntry of entries) {
      const priorName = await readPluginName(path.join(dir, priorEntry));
      if (priorName !== createdName) continue;
      try {
        await fs.rm(path.join(dir, priorEntry), {
          recursive: true,
          force: true
        });
        core.info(
          `Removed pre-existing plugin directory ${priorEntry}, superseded by newly installed "${createdName}"`
        );
        return true;
      } catch (error) {
        core.warning(
          `Failed to remove duplicate plugin directory ${priorEntry}: ${error}`
        );
        return false;
      }
    }
  }
  return false;
}

// Classify the result of a `helm plugin install` attempt based on exit code and
// stderr, so the v4 .tgz install loop can react consistently across retries.
// Duplicate-name conflicts are intentionally NOT classified here: Helm does not
// report them consistently during install (silent on Windows), so they are
// detected post-install via removePreexistingDuplicate() instead.
type PluginInstallResult = 'installed' | 'exists' | 'verify-failed' | 'failed';

function classifyPluginInstall(
  eCode: number,
  stderr: string
): PluginInstallResult {
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

          const beforeInstall = await snapshotPluginsDir();

          let eCode = await exec(
            'helm',
            ['plugin', 'install', assetUrl],
            assetOptions
          );

          let result = classifyPluginInstall(eCode, assetStderr);
          let unverified = false;
          let effectiveSnapshot = beforeInstall;

          // Verification failed (e.g., GPG key missing/wrong) — retry with
          // --verify=false. The .tgz still registers as a proper v4 plugin.
          if (result === 'verify-failed') {
            core.warning(
              `Verification failed for ${assetUrl}, retrying with --verify=false`
            );
            await removeCreatedPluginDirs(beforeInstall, 'failed verification');
            effectiveSnapshot = await snapshotPluginsDir();
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
            // Helm does not consistently report a duplicate plugin during
            // install (e.g. on Windows), so verify via the plugins directory
            // that the install did not collide with a pre-existing plugin.
            // The freshly installed package wins: it is the release this
            // action resolved, i.e. the latest version, so any pre-existing
            // copy of the same plugin is stale and gets removed.
            const replaced =
              await removePreexistingDuplicate(effectiveSnapshot);
            const replacedNote = replaced
              ? ' (replaced pre-existing duplicate)'
              : '';
            core.info(
              `Installed Helm v4 plugin from ${assetUrl}${suffix}${replacedNote}`
            );
            installed = true;
          } else if (result === 'exists') {
            core.info(`Plugin from ${assetUrl} already exists`);
            installed = true;
          } else {
            await removeCreatedPluginDirs(beforeInstall, 'failed install');
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
