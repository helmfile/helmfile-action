import * as http from '@actions/http-client';
import * as tc from '@actions/tool-cache';
import os from 'os';

export const arch = os.arch() === 'x64' ? 'amd64' : os.arch();
export const platform = os.platform() === 'win32' ? 'windows' : os.platform();

export async function download(url: string): Promise<string> {
  return await tc.downloadTool(url);
}

export async function extract(path: string, type = 'tar'): Promise<string> {
  let folder = '';
  switch (type) {
    case 'tar':
      folder = await tc.extractTar(path);
      break;
    case 'zip':
      folder = await tc.extractZip(path);
      break;
    default:
      throw Error('Invalid archive type');
  }
  return folder;
}

export async function resloveCached(
  tool: string,
  version: string
): Promise<string> {
  return tc.find(tool, version);
}

export async function resolveLatest(
  owner: string,
  repo: string
): Promise<string> {
  const httpClient = new http.HttpClient();
  const response = await httpClient.getJson<any>(
    `https://github.com/${owner}/${repo}/releases/latest`
  );
  return response.result.tag_name;
}

export async function cacheDir(
  path: string,
  tool: string,
  version: string
): Promise<string> {
  return await tc.cacheDir(path, tool, version);
}

/**
 * Parse command line arguments string into an array of arguments.
 * Handles quoted arguments properly to avoid shell interpretation issues.
 * @param argsString - The command line arguments as a string
 * @returns Array of parsed arguments
 */
export function parseArgs(argsString: string): string[] {
  if (!argsString.trim()) {
    return [];
  }

  const args: string[] = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (escaped) {
      currentArg += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        currentArg += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (currentArg) {
          args.push(currentArg);
          currentArg = '';
        }
      } else {
        currentArg += char;
      }
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}
