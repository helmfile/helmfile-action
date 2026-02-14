import {jest} from '@jest/globals';

const mockGetJson = jest.fn<any>();

// Mock the dependencies BEFORE importing the code under test
jest.unstable_mockModule('@actions/core', () => ({
  getInput: jest.fn(),
  getBooleanInput: jest.fn(),
  setFailed: jest.fn(),
  setOutput: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  addPath: jest.fn()
}));

jest.unstable_mockModule('@actions/exec', () => ({
  exec: jest.fn(),
  getExecOutput: jest.fn()
}));

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: jest.fn().mockImplementation(() => ({
    getJson: mockGetJson
  }))
}));

const {installHelmPlugins, resolveHelmV4PluginAssets} =
  await import('../src/helm');
const core = (await import('@actions/core')) as any;
const {exec, getExecOutput} = await import('@actions/exec');

const mockCore = core as jest.Mocked<typeof core>;
const mockExec = exec as jest.MockedFunction<typeof exec>;
const mockGetExecOutput = getExecOutput as jest.MockedFunction<
  typeof getExecOutput
>;

describe('installHelmPlugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock Helm v4 version output so --verify=false flag is added
    mockGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: 'v4.0.0+gc2a00e1',
      stderr: ''
    });
    // By default, return no v4 plugin assets (tests the legacy fallback path)
    mockGetJson.mockResolvedValue({result: {assets: []}});
  });

  it('should install plugin without version', async () => {
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/databus23/helm-diff',
      [],
      expect.any(Object)
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      'Plugin https://github.com/databus23/helm-diff installed successfully'
    );
  });

  it('should install plugin with version', async () => {
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff@v3.1.3']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/databus23/helm-diff --version v3.1.3',
      [],
      expect.any(Object)
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      'Plugin https://github.com/databus23/helm-diff (version v3.1.3) installed successfully'
    );
  });

  it('should install plugin with version without v prefix', async () => {
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff@3.1.3']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/databus23/helm-diff --version 3.1.3',
      [],
      expect.any(Object)
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      'Plugin https://github.com/databus23/helm-diff (version 3.1.3) installed successfully'
    );
  });

  it('should handle plugin already exists', async () => {
    const options = {
      ignoreReturnCode: true,
      listeners: {
        stderr: expect.any(Function)
      }
    };

    mockExec
      .mockImplementationOnce((command, args, opts) => {
        // Simulate stderr output
        if (opts?.listeners?.stderr) {
          opts.listeners.stderr(Buffer.from('plugin already exists'));
        }
        return Promise.resolve(1);
      })
      .mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff@v3.1.3']);

    expect(mockCore.info).toHaveBeenCalledWith(
      'Plugin https://github.com/databus23/helm-diff (version v3.1.3) already exists'
    );
  });

  it('should not parse @ in URL path as version separator', async () => {
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/user@domain.com/plugin']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/user@domain.com/plugin',
      [],
      expect.any(Object)
    );
  });

  it('should handle multiple plugins with and without versions', async () => {
    mockExec.mockResolvedValue(0);

    await installHelmPlugins([
      'https://github.com/databus23/helm-diff@v3.1.3',
      'https://github.com/jkroepke/helm-secrets',
      'https://github.com/chartmuseum/helm-push@v0.10.1'
    ]);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/databus23/helm-diff --version v3.1.3',
      [],
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/jkroepke/helm-secrets',
      [],
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/chartmuseum/helm-push --version v0.10.1',
      [],
      expect.any(Object)
    );
  });

  it('should not add --verify=false flag for Helm v3', async () => {
    // Override mock to return Helm v3 version
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'v3.15.0+gc2a00e1',
      stderr: ''
    });
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/databus23/helm-diff',
      [],
      expect.any(Object)
    );
  });

  it('should install from .tgz assets on Helm v4 when available', async () => {
    // Mock GitHub API returning v4 plugin packages (with .prov companions)
    mockGetJson.mockResolvedValueOnce({
      result: {
        assets: [
          {
            name: 'helm-secrets.tar.gz',
            browser_download_url:
              'https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/helm-secrets.tar.gz'
          },
          {
            name: 'secrets-4.7.1.tgz',
            browser_download_url:
              'https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-4.7.1.tgz'
          },
          {
            name: 'secrets-4.7.1.tgz.prov',
            browser_download_url:
              'https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-4.7.1.tgz.prov'
          },
          {
            name: 'secrets-getter-4.7.1.tgz',
            browser_download_url:
              'https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-getter-4.7.1.tgz'
          },
          {
            name: 'secrets-getter-4.7.1.tgz.prov',
            browser_download_url:
              'https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-getter-4.7.1.tgz.prov'
          }
        ]
      }
    });
    mockExec.mockResolvedValue(0);

    await installHelmPlugins([
      'https://github.com/jkroepke/helm-secrets@v4.7.1'
    ]);

    // Should install from .tgz URLs, not the repo URL
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-4.7.1.tgz',
      [],
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/jkroepke/helm-secrets/releases/download/v4.7.1/secrets-getter-4.7.1.tgz',
      [],
      expect.any(Object)
    );
    // Should NOT use --verify=false or the repo URL
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('--verify=false'),
      [],
      expect.any(Object)
    );
  });

  it('should fall back to legacy install when no .tgz assets found on Helm v4', async () => {
    // Mock GitHub API returning only platform-specific archives (no .prov files)
    mockGetJson.mockResolvedValueOnce({
      result: {
        assets: [
          {
            name: 'helm-diff-linux-amd64.tgz',
            browser_download_url:
              'https://github.com/databus23/helm-diff/releases/download/v3.15.0/helm-diff-linux-amd64.tgz'
          }
        ]
      }
    });
    mockExec.mockResolvedValue(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff']);

    // Should fall back to legacy install with --verify=false
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/databus23/helm-diff',
      [],
      expect.any(Object)
    );
    expect(mockCore.info).toHaveBeenCalledWith(
      'No Helm v4 plugin packages found for https://github.com/databus23/helm-diff, using legacy install'
    );
  });

  it('should fall back to legacy install when GitHub API fails on Helm v4', async () => {
    mockGetJson.mockRejectedValueOnce(new Error('API rate limit'));
    mockExec.mockResolvedValue(0);

    await installHelmPlugins([
      'https://github.com/jkroepke/helm-secrets@v4.7.1'
    ]);

    // Should fall back to legacy install with --verify=false
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install --verify=false https://github.com/jkroepke/helm-secrets --version v4.7.1',
      [],
      expect.any(Object)
    );
    expect(mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve Helm v4 plugin assets')
    );
  });

  it('should not query GitHub API for Helm v3', async () => {
    mockGetExecOutput.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'v3.17.3+gc2a00e1',
      stderr: ''
    });
    mockExec.mockResolvedValue(0);

    await installHelmPlugins([
      'https://github.com/jkroepke/helm-secrets@v4.7.1'
    ]);

    // Should NOT call the GitHub API
    expect(mockGetJson).not.toHaveBeenCalled();
    // Should install directly without --verify=false
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/jkroepke/helm-secrets --version v4.7.1',
      [],
      expect.any(Object)
    );
  });
});

describe('resolveHelmV4PluginAssets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return .tgz URLs that have .prov companions', async () => {
    mockGetJson.mockResolvedValueOnce({
      result: {
        assets: [
          {
            name: 'secrets-4.7.1.tgz',
            browser_download_url: 'https://example.com/secrets-4.7.1.tgz'
          },
          {
            name: 'secrets-4.7.1.tgz.prov',
            browser_download_url: 'https://example.com/secrets-4.7.1.tgz.prov'
          },
          {
            name: 'helm-secrets.tar.gz',
            browser_download_url: 'https://example.com/helm-secrets.tar.gz'
          }
        ]
      }
    });

    const result = await resolveHelmV4PluginAssets(
      'https://github.com/jkroepke/helm-secrets',
      'v4.7.1'
    );

    expect(result).toEqual(['https://example.com/secrets-4.7.1.tgz']);
  });

  it('should return empty array for non-GitHub URLs', async () => {
    const result = await resolveHelmV4PluginAssets(
      'https://example.com/my-plugin',
      'v1.0.0'
    );

    expect(result).toEqual([]);
    expect(mockGetJson).not.toHaveBeenCalled();
  });

  it('should return empty array when no .prov files exist', async () => {
    mockGetJson.mockResolvedValueOnce({
      result: {
        assets: [
          {
            name: 'helm-diff-linux-amd64.tgz',
            browser_download_url:
              'https://example.com/helm-diff-linux-amd64.tgz'
          }
        ]
      }
    });

    const result = await resolveHelmV4PluginAssets(
      'https://github.com/databus23/helm-diff',
      'v3.15.0'
    );

    expect(result).toEqual([]);
  });

  it('should use latest release URL when no version specified', async () => {
    mockGetJson.mockResolvedValueOnce({result: {assets: []}});

    await resolveHelmV4PluginAssets(
      'https://github.com/jkroepke/helm-secrets',
      ''
    );

    expect(mockGetJson).toHaveBeenCalledWith(
      'https://api.github.com/repos/jkroepke/helm-secrets/releases/latest'
    );
  });

  it('should use tagged release URL when version specified', async () => {
    mockGetJson.mockResolvedValueOnce({result: {assets: []}});

    await resolveHelmV4PluginAssets(
      'https://github.com/jkroepke/helm-secrets',
      'v4.7.1'
    );

    expect(mockGetJson).toHaveBeenCalledWith(
      'https://api.github.com/repos/jkroepke/helm-secrets/releases/tags/v4.7.1'
    );
  });
});
