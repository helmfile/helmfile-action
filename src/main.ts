import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {installHelm, installHelmPlugins} from './helm';
import {installHelmfile, HelmfileInit} from './helmfile';
import fs from 'fs';

async function run(): Promise<void> {
  try {
    const helmfileArgs = core.getInput('helmfile-args');
    const helmfileVersion = core.getInput('helmfile-version');
    const helmfileWorkDirectory = core.getInput('helmfile-workdirectory');
    const helmVersion = core.getInput('helm-version');
    const helmPlugins = core.getInput('helm-plugins');
    const helmfileAutoInit = core.getInput('helmfile-auto-init');
    const helmfileKubeconfigContext = core.getInput(
      'helmfile-kubeconfig-context'
    );
    const helmDiffColor = core.getInput('helm-diff-color');

    core.debug(`helmfile-args: ${helmfileArgs}`);
    core.debug(`helmfile-version: ${helmfileVersion}`);
    core.debug(`helmfile-workdirectory: ${helmfileWorkDirectory}`);
    core.debug(`helm-version: ${helmVersion}`);
    core.debug(`helm-plugins: ${helmPlugins}`);
    core.debug(`helmfile-auto-init: ${helmfileAutoInit}`);
    core.debug(`helm-diff-color: ${helmDiffColor}`);

    core.startGroup('Install helmfile');
    await Promise.all([installHelmfile(helmfileVersion)]);
    core.endGroup();

    switch (helmfileAutoInit) {
      case 'false':
        core.startGroup('Install helm');
        await Promise.all([installHelm(helmVersion)]);
        core.endGroup();
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

    if (helmPlugins.length > 0) {
      core.startGroup('Install helm plugins');
      await installHelmPlugins(helmPlugins.split(','));
      core.endGroup();
    }

    // Add support for helmfile-kubeconfig-context
    if (helmfileKubeconfigContext.length > 0) {
      core.startGroup('Set helmfile-kubeconfig-context');
      // make sure the kubeconfig dir exists
      const mkdirExitcode = await exec.exec('mkdir -p ~/.kube', [], {
        ignoreReturnCode: true
      });
      if (mkdirExitcode !== 0) {
        throw new Error(
          `The process 'mkdir -p ~/.kube' failed with exit code ${mkdirExitcode}`
        );
      }

      // write helmfileKubeconfigContext to the ~/.kube/config file
      const helmfileKubeconfigContextFile = `${process.env.HOME}/.kube/config`;
      fs.writeFile(
        helmfileKubeconfigContextFile,
        helmfileKubeconfigContext,
        err => {
          if (err) {
            throw new Error(
              `Failed to write helmfile-kubeconfig-context to ${helmfileKubeconfigContextFile}`
            );
          }
        }
      );
      core.endGroup();
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

    // set HELM_DIFF_COLOR=true into the helmfile command's environment
    options.env = {
      HELM_DIFF_COLOR: helmDiffColor,
      ...process.env
    };

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
