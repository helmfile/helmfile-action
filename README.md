# helmfile-action

Setup [Helmfile](https://github.com/helmfile/helmfile) and [Helm](https://github.com/helm/helm) for use in GitHub Actions.

This action works on Linux, macOS and Windows

```yaml
- uses: helmfile/helmfile-action@v2.0.4
  with:
    helmfile-args: apply
```

## Optional Inputs
- `helmfile-args` : helmfile arguments. Required.
- `helmfile-version` : helmfile version. Default `"latest"`.
- `helmfile-workdirectory` : helmfile working directory. Default `"."`
- `helm-version` : Helm version. Default `"latest"`
- `helm-plugins` : Comma separated list of Helm plugins to install. Default `https://github.com/databus23/helm-diff`. Supports version pinning using `@version` suffix (e.g., `https://github.com/databus23/helm-diff@v3.1.3`).
- `helmfile-auto-init` : Whether to run `helmfile init` before running helmfile command. Default `"false"`
- `helmfile-kubeconfig-context` : Kubeconfig context. Default `""`, if not empty, it will be written to `$HOME/.kube/config`
- `helm-diff-color`: Enable helm diff plugin color output. Default `"true"`.

Example with optional inputs

```yaml
- uses: helmfile/helmfile-action@v2.0.4
  with:
    helmfile-version: 'v0.150.0'
    helm-version: 'v3.11.0'
    helm-plugins: >
      https://github.com/databus23/helm-diff@v3.1.3,
      https://github.com/jkroepke/helm-secrets@v4.2.2
    helmfile-args: apply --environment prod
    helmfile-auto-init: "false"
```

## Outputs
- `exit-code` : Exit code of helmfile. Useful to handle diff `--detailed-exitcode`.
- `helmfile-stdout` : Standard output of helmfile command.
- `helmfile-stderr` : Error output of helmfile command.

## Build action (for maintainer)

```
$ npm install
$ npm run all
```

> `dist/*` should be included in commit.
