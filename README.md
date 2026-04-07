# biome-setup

An interactive CLI tool to help you migrate from ESLint and Prettier to [Biome](https://biomejs.dev) in your React or Node.js projects — or upgrade an existing Biome installation to the latest version.

## About Biome

Biome is a fast toolchain for the web that replaces ESLint, Prettier, and other JavaScript/TypeScript development tools in a single package. It's written in Rust and provides blazing-fast linting and formatting.

## Features

- 🚀 **Interactive Setup**: Walk through a guided setup process for your project
- ⚡ **Fast**: Leverages Biome's Rust-based engine for rapid linting and formatting
- 🔄 **Easy Migration**: Seamlessly migrate from ESLint/Prettier to Biome
- ⬆️ **Upgrade Detection**: Detects existing Biome installations and offers to upgrade the version, with the option to keep your current config or overwrite it with the recommended setup
- ⚙️ **Project Detection**: Automatically detects your project type (React or Node.js)
- 🎯 **TypeScript Support**: Full TypeScript support for modern projects
- 📄 **FracturedJson Formatting**: Optional human-readable JSON formatting with intelligent inline/multi-line decisions and table-like alignment
- 🪝 **Lefthook Integration**: Optional pre-commit hook that auto-fixes lint issues and stages corrected files
- 🐶 **Husky Migration**: Automatically detects Husky, removes it completely, and migrates existing hooks to Lefthook

## Installation

No installation needed! Use it directly with npx:

```bash
npx @herowcode/biome-setup
```

## Usage

Run the tool in your project root directory:

```bash
npx @herowcode/biome-setup
```

### New project (no Biome installed)

The tool will guide you through:
1. Detecting your project type (React or Node.js) and package manager
2. Removing ESLint/Prettier packages and directive comments
3. Installing Biome and generating a `biome.json` configuration file
4. Optionally enabling FracturedJson for human-readable JSON formatting
5. Optionally installing Lefthook with a pre-commit hook for lint:fix
6. Updating `package.json` scripts and running an initial lint fix

### Existing Biome project

If Biome is already installed, the tool detects the current version and offers:
- **Update version only** — upgrades the `@biomejs/biome` dependency and updates the `$schema` URL in your existing `biome.json`, keeping all your custom rules intact
- **Update version + overwrite config** — upgrades the dependency and replaces `biome.json` with the recommended opinionated configuration (with optional FracturedJson formatting and Lefthook setup)

### Lefthook pre-commit hook

When enabled (default: **yes**), [Lefthook](https://github.com/evilmartians/lefthook) is installed and configured with a `pre-commit` hook that:

1. Runs `biome lint --fix` on staged files to auto-correct lint issues
2. Re-stages the corrected files with `git add` so fixes are included in the current commit

The tool will:
1. Install `lefthook` as a devDependency in your project
2. Generate a `lefthook.yml` configuration at your project root
3. Run `lefthook install` to register the git hook in `.git/hooks`

#### Husky migration

If your project already uses [Husky](https://github.com/typicode/husky), the tool will automatically:

1. **Detect** Husky via the `.husky` directory, the `husky` package in dependencies, or the `husky` field in `package.json`
2. **Read** existing hook scripts (e.g. `pre-commit`, `commit-msg`, `pre-push`) and extract the commands
3. **Remove** Husky completely — uninstalls the package, deletes the `.husky` directory, removes the `prepare` script and `husky` config from `package.json`
4. **Migrate** extracted commands into `lefthook.yml`, skipping redundant ESLint/Prettier/lint-staged commands that Biome replaces

This ensures a seamless transition without losing any custom hooks you had configured.

### FracturedJson formatting

When enabled, [FracturedJson](https://github.com/j-brooke/FracturedJsonJs) formats your JSON files with:
- Intelligent inline vs multi-line decisions based on line length
- Table-like alignment of object fields
- Compact multi-item array rows

The tool will:
1. Install `fracturedjsonjs` as a devDependency in your project
2. Generate a `format-json.js` script in your project root
3. Append `&& node format-json.js` to the `lint:fix` script so JSON formatting runs automatically
4. Add `*.json` and `*.jsonc` to Biome's `formatter.ignore` to avoid conflicts

Biome's JSON **linting** remains active — only **formatting** is delegated to FracturedJson.

## Available Scripts

In this package:

```bash
# Run linting checks
pnpm lint

# Run linting and fix issues
pnpm lint:fix

# Create a patch version release
pnpm version:patch

# Create a minor version release
pnpm version:minor

# Create a major version release
pnpm version:major
```

## Configuration

The tool generates a `biome.json` configuration file in your project. This file includes:

- **Linter**: ESLint-compatible linting rules
- **Formatter**: Code formatting preferences
- **JavaScript/TypeScript**: Language-specific settings

You can manually edit the `biome.json` file to customize Biome's behavior for your project.

## Requirements

- Node.js 18+
- pnpm 10.17.1+ (as the project package manager)

## Dependencies

- **chalk**: Terminal styling for colorful output
- **inquirer**: Interactive CLI prompts
- **@biomejs/biome**: The Biome toolchain itself
- **fracturedjsonjs**: Installed in the target project when FracturedJson formatting is enabled (not a dependency of biome-setup itself)
- **lefthook**: Installed in the target project when Lefthook integration is enabled (not a dependency of biome-setup itself)

## CI/CD

This project uses GitHub Actions for continuous integration:

- **Lint**: Runs on every push and pull request to ensure code quality
- **Publish**: Automatically publishes to npm when a version tag is pushed

## License

MIT

## Author

Judson Junior (judson.junior@herowcode.com)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Links

- [Biome Documentation](https://biomejs.dev)
- [npm Package](https://www.npmjs.com/package/@herowcode/biome-setup)
