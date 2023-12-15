import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {installHelm, installHelmPlugins} from './helm';
import {installHelmfile, HelmfileInit} from './helmfile';

async function run(): Promise<void> {
  try {
    const helmfileArgs = core.getInput('helmfile-args');
    const helmfileVersion = core.getInput('helmfile-version');
    const helmfileWorkDirectory = core.getInput('helmfile-workdirectory');
    const helmVersion = core.getInput('helm-version');
    const helmPlugins = core.getInput('helm-plugins');
    const helmfileAutoInit = core.getInput('helmfile-auto-init');

    core.debug(`helmfile-args: ${helmfileArgs}`);
    core.debug(`helmfile-version: ${helmfileVersion}`);
    core.debug(`helmfile-workdirectory: ${helmfileWorkDirectory}`);
    core.debug(`helm-version: ${helmVersion}`);
    core.debug(`helm-plugins: ${helmPlugins}`);

    core.startGroup('Install helmfile');
    await Promise.all([installHelmfile(helmfileVersion)]);
    core.endGroup();

    switch (helmfileAutoInit) {
      case 'false':
        core.startGroup('Install helm');
        await Promise.all([installHelm(helmVersion)]);
        core.endGroup();

        if (helmPlugins.length > 0) {
          core.startGroup('Install helm plugins');
          await installHelmPlugins(helmPlugins.split(','));
          core.endGroup();
        }
        break;
      case 'true':
        core.startGroup('helmfile init');
        await Promise.all([HelmfileInit()]);
        core.endGroup();
        break;
      default:
        core.setFailed(
          `helmfile-auto-init: ${helmfileAutoInit} is not a valid value. Valid values are 'true' or 'false'`
        );
        return;
    }

    const options: exec.ExecOptions = {};
    if (helmfileWorkDirectory != '') {
      options.cwd = helmfileWorkDirectory;
    }

    let helmfileStdout = '';
    let helmfileStderr = '';

    options.listeners = {
      stdout: (data: Buffer) => {
        helmfileStdout += data.toString();
      },
      stderr: (data: Buffer) => {
        helmfileStderr += data.toString();
      }
    };

    options.ignoreReturnCode = true;

    const processExitCode = await exec.exec(
      `helmfile ${helmfileArgs}`,
      [],
      options
    );

    core.setOutput('exit-code', processExitCode);
    core.setOutput('helmfile-stdout', helmfileStdout);
    core.setOutput('helmfile-stderr', helmfileStderr);

    if (processExitCode !== 0 && processExitCode !== 2) {
      throw new Error(
        `The process 'helmfile ${helmfileArgs}' failed with exit code ${processExitCode}`
      );
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
