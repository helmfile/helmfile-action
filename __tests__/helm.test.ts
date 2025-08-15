import {installHelmPlugins} from '../src/helm';
import * as core from '@actions/core';
import {exec} from '@actions/exec';

// Mock the dependencies
jest.mock('@actions/core');
jest.mock('@actions/exec');

const mockCore = core as jest.Mocked<typeof core>;
const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('installHelmPlugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should install plugin without version', async () => {
    mockExec.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await installHelmPlugins(['https://github.com/databus23/helm-diff']);

    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/databus23/helm-diff',
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
      'helm plugin install https://github.com/databus23/helm-diff --version v3.1.3',
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
      'helm plugin install https://github.com/databus23/helm-diff --version 3.1.3',
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
      'helm plugin install https://github.com/user@domain.com/plugin',
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
      'helm plugin install https://github.com/databus23/helm-diff --version v3.1.3',
      [],
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/jkroepke/helm-secrets',
      [],
      expect.any(Object)
    );
    expect(mockExec).toHaveBeenCalledWith(
      'helm plugin install https://github.com/chartmuseum/helm-push --version v0.10.1',
      [],
      expect.any(Object)
    );
  });
});
