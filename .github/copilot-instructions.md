# helmfile-action

GitHub Action that sets up Helmfile and Helm tools for use in GitHub Actions workflows. This action downloads, installs, and configures both Helmfile and Helm with optional plugins, working on Linux, macOS, and Windows.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Build
- Install dependencies: `npm install` -- takes 90 seconds. NEVER CANCEL. Set timeout to 3+ minutes.
- Build TypeScript: `npm run build` -- takes 5 seconds. Compiles src/ to lib/ using tsc (lib/ is git-ignored).
- Format code: `npm run format` -- takes 1 second. Uses Prettier on TypeScript and YAML files.
- Lint code: `npm run lint` -- takes 2 seconds. Uses ESLint with TypeScript rules.
- Package action: `npm run package` -- takes 4 seconds. Uses ncc to bundle lib/ into dist/index.js.
- Full build: `npm run all` -- takes 10 seconds. NEVER CANCEL. Runs build + format + lint + package.

### Development Workflow
- ALWAYS run `npm install` first on a fresh clone.
- Use `npm run all` for complete validation before committing.
- The dist/ directory MUST be committed - it contains the bundled action code.
- Action entry point is `dist/index.js` (built from `src/main.ts`).
- The lib/ directory is git-ignored and contains intermediate TypeScript compilation output.

### Required Steps Before Committing
1. `npm run all` - Complete build pipeline 
2. Verify dist/ changes are included in commit
3. Test changes via GitHub Actions workflows for full validation

### Validation Commands
- Check formatting: `npm run format-check` -- ensures Prettier formatting is correct.
- Auto-fix linting: `npm run lint:fix` -- automatically fixes ESLint issues.
- ALWAYS run `npm run format` and `npm run lint` before committing or CI will fail.

## Testing and Validation

### Local Testing
- No meaningful unit tests exist (`npm test` just echoes "No tests yet").
- Action can be executed locally with: `node dist/index.js` but will fail without GitHub Actions environment variables.
- Testing is primarily done through CI workflows that actually use the action.

### Manual Validation Scenarios
- ALWAYS test your changes through the CI workflows in .github/workflows/basic-validation.yml.
- The CI tests the action setup (Helmfile/Helm installation) without running actual helmfile commands.
- Two test scenarios: `helmfile-auto-init: false` (installs Helm separately) and `helmfile-auto-init: true` (runs helmfile init).
- Both scenarios test plugin installation with helm-diff and helm-secrets plugins.
- For complete validation, create a test workflow that includes `helmfile-args` to test actual execution.
- Test the action locally with: `node dist/index.js` - it will fail with "versionSpec parameter is required" without GitHub Actions environment.

### CI Validation
- GitHub Actions workflows test the action on ubuntu-latest, windows-latest, and macos-latest.
- The check-dist.yml workflow ensures dist/ is properly updated.
- Use these workflows to validate your changes actually work.

## Key Components

### Source Structure
```
src/
├── main.ts       # Main entry point, coordinates installation and execution
├── helmfile.ts   # Helmfile installation and initialization
├── helm.ts       # Helm installation and plugin management  
├── helpers.ts    # Utility functions for downloads and caching
```

### Configuration Files
- `action.yaml` - GitHub Action definition with inputs/outputs
- `package.json` - npm scripts and dependencies
- `tsconfig.json` - TypeScript compilation settings
- `.eslintrc.js` - ESLint configuration (from actions/reusable-workflows)
- `.prettierrc.js` - Prettier formatting configuration

### Build Artifacts
- `lib/` - TypeScript compilation output (git-ignored)
- `dist/index.js` - Bundled action code (MUST be committed)
- `dist/index.js.map` - Source map for debugging
- `dist/licenses.txt` - License information from dependencies

## Action Parameters and Behavior

### Key Inputs
- `helmfile-args` - Required. Arguments passed to helmfile command
- `helmfile-version` - Helmfile version (default: "latest")
- `helm-version` - Helm version (default: "latest")  
- `helm-plugins` - Comma-separated plugin URLs (default: helm-diff)
- `helmfile-auto-init` - Whether to run helmfile init (default: "false")
- `helmfile-workdirectory` - Working directory (default: ".")

### Outputs
- `exit-code` - Helmfile command exit code
- `helmfile-stdout` - Standard output from helmfile
- `helmfile-stderr` - Error output from helmfile

### Installation Process
1. Downloads and caches Helmfile binary from GitHub releases
2. Either installs Helm separately OR runs `helmfile init` if auto-init enabled
3. Installs specified Helm plugins
4. Sets up kubeconfig if provided
5. Executes helmfile command with provided arguments

## Platform Support
- Linux (amd64) - Primary development platform
- macOS (amd64) - Supported 
- Windows (amd64) - Supported with zip archives instead of tar.gz

## Common Tasks Reference

### Repository Root Structure
```
.
├── .github/          # GitHub workflows and configuration
├── __tests__/        # Placeholder test directory (empty)
├── dist/            # Bundled action code (committed)
├── src/             # TypeScript source code
├── action.yaml      # Action definition
├── package.json     # npm configuration
├── README.md        # Action documentation
└── tsconfig.json    # TypeScript config
```

### Dependencies
- @actions/core - GitHub Actions toolkit
- @actions/exec - Process execution
- @actions/http-client - HTTP requests
- @actions/tool-cache - Tool caching and downloads

### Troubleshooting
- If build fails, ensure dependencies are installed with `npm install`
- TypeScript version 5.8.3 shows ESLint warnings but works correctly - this is expected
- Platform detection handles Windows vs Unix file extensions automatically
- Tool caching prevents re-downloading on subsequent runs
- Action execution outside GitHub Actions environment fails with "versionSpec parameter is required" - this is normal