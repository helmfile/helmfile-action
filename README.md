# helmfile-action

Setup [Helmfile](https://github.com/helmfile/helmfile) and [Helm](https://github.com/helm/helm) for use in GitHub Actions.

This action works on Linux, MacOS and Windows

```yaml
- uses: helmfile/helmfile-action@v1
  with:
    helmfile-args: apply
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # required, if explicit versions are not set
```

## Optional Inputs
- `helmfile-args` : helmfile arguments. Required.
- `helmfile-version` : helmfile version. Default `"latest"`.
- `helm-version` : Helm version. Default `"latest"`
- `helm-plugins` : Comma separated list of Helm plugins to install. Default `https://github.com/databus23/helm-diff`

Example with optional inputs

```yaml
- uses: helmfile/helmfile-action@v1
  with:
    helmfile-version: 'v0.150.0'
    helm-version: 'v3.11.0'
    helm-plugins: >
      https://github.com/databus23/helm-diff,
      https://github.com/jkroepke/helm-secrets
    helmfile-args: apply --environment prod
```

## Build action (for maintainer)

```
$ npm install
$ npm run all
```

> `dist/*` shoud be included in commit.
