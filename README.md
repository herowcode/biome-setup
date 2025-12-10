# biome-setup

An interactive CLI tool to help you migrate from ESLint and Prettier to [Biome](https://biomejs.dev) in your React or Node.js projects.

## About Biome

Biome is a fast toolchain for the web that replaces ESLint, Prettier, and other JavaScript/TypeScript development tools in a single package. It's written in Rust and provides blazing-fast linting and formatting.

## Features

- 🚀 **Interactive Setup**: Walk through a guided setup process for your project
- ⚡ **Fast**: Leverages Biome's Rust-based engine for rapid linting and formatting
- 🔄 **Easy Migration**: Seamlessly migrate from ESLint/Prettier to Biome
- ⚙️ **Project Detection**: Automatically detects your project type (React or Node.js)
- 🎯 **TypeScript Support**: Full TypeScript support for modern projects

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

The tool will guide you through:
1. Selecting your project type (React or Node.js)
2. Choosing configuration options
3. Generating a `biome.json` configuration file
4. Setting up your project to use Biome

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
