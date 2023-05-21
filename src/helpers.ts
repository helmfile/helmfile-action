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
