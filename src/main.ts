import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {installHelm, installHelmPlugins} from './helm';
import {installHelmfile} from './helmfile';


async function run(): Promise<void> {
  try {
    const helmfileArgs = core.getInput('helmfile-args');
    const helmfileVersion = core.getInput('helmfile-version');
    const helmfileWorkDirectory = core.getInput('helmfile-workdirectory');
    const helmVersion = core.getInput('helm-version');
    const helmPlugins = core.getInput('helm-plugins');

    core.debug(`helmfile-args: ${helmfileArgs}`);
    core.debug(`helmfile-version: ${helmfileVersion}`);
    core.debug(`helmfile-workdirectory: ${helmfileWorkDirectory}`);
    core.debug(`helm-version: ${helmVersion}`);
    core.debug(`helm-plugins: ${helmPlugins}`);

    await Promise.all([
      installHelm(helmVersion),
      installHelmfile(helmfileVersion)
    ]);

    if (helmPlugins.length > 0) {
      await installHelmPlugins(helmPlugins.split(','));
    }

    const options: exec.ExecOptions = {};
    if (helmfileWorkDirectory != '') {
      options.cwd = helmfileWorkDirectory;
    }

    options.ignoreReturnCode = true;

    const processExitCode = await exec.exec(
      `helmfile ${helmfileArgs}`,
      [],
      options
    );

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
