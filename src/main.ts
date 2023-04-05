import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {installHelm, installHelmPlugins} from './helm';
import {installHelmfile} from './helmfile';

async function run(): Promise<void> {
  try {
    const helmfileArgs = core.getInput('helmfile-args');
    const helmfileVersion = core.getInput('helmfile-version');
    const helmVersion = core.getInput('helm-version');
    const helmPlugins = core.getInput('helm-plugins');

    core.debug(`helmfile-args: ${helmfileArgs}`);
    core.debug(`helmfile-version: ${helmfileVersion}`);
    core.debug(`helm-version: ${helmVersion}`);
    core.debug(`helm-plugins: ${helmPlugins}`);

    await Promise.all([
      installHelm(helmVersion),
      installHelmfile(helmfileVersion)
    ]);

    if (helmPlugins.length > 0) {
      await installHelmPlugins(helmPlugins.split(','));
    }

    await exec.exec(`helmfile ${helmfileArgs}`);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
