#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const cp = require("node:child_process")
// Inquirer v9+ is ESM; grab default export when required from CJS.
const inquirerModule = require("inquirer")
const inquirer = inquirerModule.default || inquirerModule
// Chalk v5 is ESM-only; fall back to .default when required from CJS.
const chalkModule = require("chalk")
const chalk = chalkModule.default || chalkModule

const BIOME_VERSION = "2.4.8"
const BIOME_SCHEMA_URL = `https://biomejs.dev/schemas/${BIOME_VERSION}/schema.json`
const PROJECT_ROOT = process.cwd()
const PATHS = Object.freeze({
  packageJson: path.join(PROJECT_ROOT, "package.json"),
  biomeConfig: path.join(PROJECT_ROOT, "biome.json"),
  formatJsonScript: path.join(PROJECT_ROOT, "format-json.js"),
})

function findUpwards(filenames) {
  let current = PROJECT_ROOT

  while (true) {
    for (const name of filenames) {
      const candidate = path.join(current, name)
      if (fs.existsSync(candidate)) {
        return { directory: current, file: candidate, name }
      }
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

const PROJECT_TYPE = Object.freeze({
  react: "react",
  node: "node",
})

function isTypescriptProject(pkg) {
  const tsconfigPath = path.join(PROJECT_ROOT, "tsconfig.json")
  if (fs.existsSync(tsconfigPath)) return true

  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]

  for (const field of dependencyFields) {
    const deps = pkg[field]
    if (deps?.typescript) return true
  }

  return false
}

function inferProjectType(pkg) {
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]

  for (const field of dependencyFields) {
    const deps = pkg[field]
    if (!deps) continue

    if (deps.next || deps.react || deps["react-dom"]) {
      return PROJECT_TYPE.react
    }
  }

  return PROJECT_TYPE.node
}

function hasNextJsDependency(pkg) {
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]

  return dependencyFields.some((field) => Boolean(pkg[field]?.next))
}

function hasNextBuildDirectory() {
  return fs.existsSync(path.join(PROJECT_ROOT, ".next"))
}

function shouldIgnoreNextDirectory(pkg) {
  return hasNextBuildDirectory() || hasNextJsDependency(pkg)
}

const LEGACY_TOOL_PATTERN = /(eslint|prettier)/i

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
])

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".vscode",
  ".idea",
])

const ESLINT_DIRECTIVE_PATTERNS = [
  /\/\*\s*eslint-disable[\s\S]*?\*\//g,
  /\/\*\s*eslint-enable[\s\S]*?\*\//g,
  /\/\*\s*eslint-env[\s\S]*?\*\//g,
  /\/\*\s*eslint\s+[^*]*\*\//g,
  /\/\/\s*eslint-disable[^\n\r]*/g,
  /\/\/\s*eslint-enable[^\n\r]*/g,
  /\/\/\s*eslint-env[^\n\r]*/g,
  /\/\/\s*eslint-[^\n\r]*/g,
]

const PACKAGE_MANAGERS = Object.freeze({
  pnpm: {
    id: "pnpm",
    lockFile: "pnpm-lock.yaml",
    buildInstallCommand: (dependency) => `pnpm add -D -E ${dependency}`,
    buildUninstallCommand: (packages) => `pnpm remove ${packages.join(" ")}`,
    lint: {
      run: "pnpm lint",
      fix: "pnpm lint:fix",
    },
  },
  yarn: {
    id: "yarn",
    lockFile: "yarn.lock",
    buildInstallCommand: (dependency) => `yarn add -D -E ${dependency}`,
    buildUninstallCommand: (packages) => `yarn remove ${packages.join(" ")}`,
    lint: {
      run: "yarn lint",
      fix: "yarn lint:fix",
    },
  },
  bun: {
    id: "bun",
    lockFile: "bun.lockb",
    buildInstallCommand: (dependency) => `bun add -D -E ${dependency}`,
    buildUninstallCommand: (packages) => `bun remove ${packages.join(" ")}`,
    lint: {
      run: "bun run lint",
      fix: "bun run lint:fix",
    },
  },
  npm: {
    id: "npm",
    lockFile: null,
    buildInstallCommand: (dependency) => `npm install -D -E ${dependency}`,
    buildUninstallCommand: (packages) => `npm uninstall ${packages.join(" ")}`,
    lint: {
      run: "npm run lint",
      fix: "npm run lint:fix",
    },
  },
})

const PACKAGE_MANAGER_PRIORITY = ["pnpm", "yarn", "bun"]

class CliError extends Error {
  constructor(message) {
    super(message)
    this.name = "CliError"
  }
}

const logger = {
  info: (message) => console.log(chalk.white(message)),
  success: (message) => console.log(chalk.green(message)),
  warn: (message) => console.log(chalk.yellow(message)),
  error: (message) => console.error(chalk.red(message)),
  step: (message) => console.log(chalk.cyan(message)),
  command: (command) => console.log(chalk.gray(`> ${command}`)),
}

function detectPackageManager() {
  const extractFromPackageManagerField = (pkgJsonPath) => {
    if (!pkgJsonPath) return null
    try {
      const raw = fs.readFileSync(pkgJsonPath, "utf8")
      const parsed = JSON.parse(raw)
      if (typeof parsed.packageManager === "string") {
        const [id] = parsed.packageManager.split("@")
        if (PACKAGE_MANAGERS[id]) return PACKAGE_MANAGERS[id]
      }
    } catch (_) {
      // ignore and continue probing
    }
    return null
  }

  // 1) Local package.json (current workspace) field takes precedence.
  const fromLocalField = extractFromPackageManagerField(PATHS.packageJson)
  if (fromLocalField) return fromLocalField

  // 2) Walk upward to find nearest package.json with packageManager (monorepos).
  const upstreamPkg = findUpwards(["package.json"])
  if (upstreamPkg && upstreamPkg.file !== PATHS.packageJson) {
    const fromUpstreamField = extractFromPackageManagerField(upstreamPkg.file)
    if (fromUpstreamField) return fromUpstreamField
  }

  // 3) Look for lockfiles upward in priority order.
  for (const id of PACKAGE_MANAGER_PRIORITY) {
    const candidate = PACKAGE_MANAGERS[id]
    if (!candidate.lockFile) continue
    const found = findUpwards([candidate.lockFile])
    if (found) {
      return candidate
    }
  }

  // 4) Fallback to npm.
  return PACKAGE_MANAGERS.npm
}

function ensurePackageJsonExists() {
  if (!fs.existsSync(PATHS.packageJson)) {
    throw new CliError(
      "No package.json found. Please run this command in your project root.",
    )
  }
}

function readPackageJson() {
  ensurePackageJsonExists()
  try {
    const raw = fs.readFileSync(PATHS.packageJson, "utf8")
    return JSON.parse(raw)
  } catch (error) {
    throw new CliError(`Could not read or parse package.json: ${error.message}`)
  }
}

function writePackageJson(pkg) {
  fs.writeFileSync(PATHS.packageJson, `${JSON.stringify(pkg, null, 2)}\n`)
}

function printBanner() {
  console.log("")
  console.log(chalk.cyan("==============================================="))
  console.log(chalk.cyan("          Biome Migration Assistant"))
  console.log(chalk.cyan("==============================================="))
  console.log("")
}

function findExistingBiome(pkg) {
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]

  for (const field of dependencyFields) {
    const deps = pkg[field]
    if (deps?.["@biomejs/biome"]) {
      return deps["@biomejs/biome"].replace(/^[\^~>=<]*/, "")
    }
  }

  return null
}

function findLegacyTools(pkg) {
  const legacy = new Set()
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]

  dependencyFields.forEach((field) => {
    const deps = pkg[field]
    if (!deps) return

    Object.keys(deps).forEach((name) => {
      if (LEGACY_TOOL_PATTERN.test(name)) {
        legacy.add(name)
      }
    })
  })

  return Array.from(legacy)
}

function runCommand(command) {
  logger.command(command)
  try {
    cp.execSync(command, { stdio: "inherit" })
  } catch (error) {
    const exitCode =
      error && typeof error.status === "number"
        ? ` (exit code ${error.status})`
        : ""
    throw new CliError(`Command failed: ${command}${exitCode}`)
  }
}

function uninstallLegacyTools(pmConfig, packages) {
  if (!packages.length) return

  console.log("")
  logger.warn("Removing ESLint/Prettier related packages:")
  logger.warn(`  ${packages.join(", ")}`)
  console.log("")

  const command = pmConfig.buildUninstallCommand(packages)
  runCommand(command)
}

function cleanEslintPrettierConfig(pkg) {
  let changed = false
  if (pkg.eslintConfig) {
    delete pkg.eslintConfig
    changed = true
  }
  if (pkg.prettier) {
    delete pkg.prettier
    changed = true
  }
  return changed
}

function installBiome(pmConfig) {
  const command = pmConfig.buildInstallCommand(
    `@biomejs/biome@${BIOME_VERSION}`,
  )
  console.log("")
  logger.success(`Installing Biome version ${BIOME_VERSION}...`)
  runCommand(command)
}

function installFracturedJson(pmConfig) {
  const command = pmConfig.buildInstallCommand("fracturedjsonjs")
  console.log("")
  logger.success("Installing FracturedJson...")
  runCommand(command)
}

function writeFormatJsonScript() {
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const {
  Formatter,
  FracturedJsonOptions,
  EolStyle,
} = require("fracturedjsonjs")

const JSON_EXTENSIONS = new Set([".json", ".jsonc"])

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".vscode",
  ".idea",
  ".next",
])

const options = new FracturedJsonOptions()
options.MaxTotalLineLength = 80
options.MaxInlineComplexity = 1
options.MaxCompactArrayComplexity = 2
options.IndentSpaces = 2
options.JsonEolStyle = EolStyle.Lf

const formatter = new Formatter()
formatter.Options = options

let filesScanned = 0
let filesFormatted = 0

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      walk(entryPath)
      continue
    }

    if (!entry.isFile()) continue
    if (!JSON_EXTENSIONS.has(path.extname(entryPath))) continue

    filesScanned += 1
    try {
      const original = fs.readFileSync(entryPath, "utf8")
      const formatted = formatter.Reformat(original)
      if (formatted !== original) {
        fs.writeFileSync(entryPath, formatted)
        filesFormatted += 1
      }
    } catch (_) {
      // skip files that aren't valid JSON
    }
  }
}

walk(process.cwd())
console.log(
  \`FracturedJson: formatted \${filesFormatted} of \${filesScanned} JSON files.\`,
)
`
  fs.writeFileSync(PATHS.formatJsonScript, script)
  logger.success("Created format-json.js script")
}

function createBiomeConfig(projectType, options = {}) {
  const includes = [
    "**",
    "!**/dist/**",
    "!**/node_modules/**",
    "!**/.git/**",
    "!**/coverage/**",
  ]

  if (options.ignoreNextDirectory) {
    includes.push("!**/.next/**")
  }

  const baseConfig = {
    // biome-ignore lint/style/useNamingConvention: ignore schema property
    $schema: BIOME_SCHEMA_URL,
    linter: {
      enabled: true,
      rules: {
        recommended: true,
        style: {
          useTemplate: "error",
          useImportType: "error",
          noParameterAssign: "error",
          useAsConstAssertion: "error",
          useDefaultParameterLast: "error",
          useEnumInitializers: "error",
          useSelfClosingElements: "error",
          useConst: "error",
          useSingleVarDeclarator: "error",
          noUnusedTemplateLiteral: "error",
          useNumberNamespace: "error",
          noInferrableTypes: "error",
          noUselessElse: "error",
          useNamingConvention: {
            level: "error",
            options: {
              strictCase: false,
              conventions: [
                {
                  selector: {
                    kind: "interface",
                  },
                  match: "I(.*)|(.*?)Error",
                  formats: ["PascalCase"],
                },
                {
                  selector: {
                    kind: "typeAlias",
                  },
                  match: "T(.*)|(.*?)Error",
                  formats: ["PascalCase"],
                },
                {
                  selector: {
                    kind: "objectLiteralProperty",
                  },
                  formats: [
                    "camelCase",
                    "snake_case",
                    "CONSTANT_CASE",
                    "PascalCase",
                  ],
                },
                {
                  selector: {
                    kind: "enum",
                  },
                  match: "E(.*)|(.*?)Error",
                  formats: ["PascalCase"],
                },
                {
                  selector: {
                    kind: "enumMember",
                  },
                  formats: ["CONSTANT_CASE"],
                },
              ],
            },
          },
        },
        correctness: {
          noUnusedVariables: "warn",
          noUnusedImports: "error",
        },
      },
    },
    files: {
      includes,
    },
    assist: {
      actions: {
        source: {
          organizeImports: {
            level: "on",
            options: {
              groups: [
                [":URL:", ":NODE:", ":PACKAGE:"],
                ":BLANK_LINE:",
                ["@/"],
              ],
            },
          },
        },
      },
    },
    formatter: {
      enabled: true,
      indentStyle: "space",
      indentWidth: 2,
      lineWidth: 80,
      ...(() => {
        const formatterIncludes = []
        if (options.ignoreNextDirectory) formatterIncludes.push("!**/.next/**")
        if (options.fracturedJson) formatterIncludes.push("!**/*.json", "!**/*.jsonc")
        return formatterIncludes.length > 0 ? { includes: formatterIncludes } : {}
      })(),
    },
    javascript: {
      formatter: {
        indentStyle: "space",
        indentWidth: 2,
        quoteStyle: "double",
        semicolons: "asNeeded",
        lineEnding: "lf",
      },
    },
    vcs: {
      enabled: false,
      clientKind: "git",
      useIgnoreFile: false,
    },
  }

  if (projectType === PROJECT_TYPE.react) {
    return {
      ...baseConfig,
      css: {
        parser: {
          tailwindDirectives: true,
        },
      },
    }
  }

  return baseConfig
}

function writeBiomeConfig(projectType, configOptions = {}) {
  if (fs.existsSync(PATHS.biomeConfig)) {
    logger.warn("A biome.json file already exists. It will not be overwritten.")
    return
  }

  const pkg = readPackageJson()
  const config = createBiomeConfig(projectType, {
    ignoreNextDirectory: shouldIgnoreNextDirectory(pkg),
    ...configOptions,
  })
  fs.writeFileSync(PATHS.biomeConfig, `${JSON.stringify(config, null, 2)}\n`)
  logger.success(`Created biome.json for project type: ${projectType}`)
  if (configOptions.fracturedJson) {
    logger.success(
      "JSON files excluded from Biome formatter (using FracturedJson instead)",
    )
  }
}

function updatePackageJsonScripts(pmConfig, options = {}) {
  const pkg = readPackageJson()
  pkg.scripts = pkg.scripts || {}

  const isTs = isTypescriptProject(pkg)
  const fjSuffix = options.fracturedJson ? " && node format-json.js" : ""

  console.log("")
  logger.step(
    `Adding scripts using package manager: ${chalk.bold(pmConfig.id)}`,
  )

  if (isTs) {
    pkg.scripts["type-check"] = "tsc --noEmit"
    pkg.scripts.lint = `biome lint --diagnostic-level=error --no-errors-on-unmatched && ${pmConfig.id} run type-check`
    pkg.scripts["lint:fix"] =
      `biome check --write --unsafe && ${pmConfig.id} run type-check${fjSuffix}`
  } else {
    pkg.scripts.lint =
      "biome lint --diagnostic-level=error --no-errors-on-unmatched"
    pkg.scripts["lint:fix"] = `biome check --write --unsafe${fjSuffix}`
  }

  writePackageJson(pkg)
  logger.success("Added scripts to package.json: lint, lint:fix")
}

function shouldIgnoreDir(dirName, pkg) {
  if (dirName === ".next") {
    return shouldIgnoreNextDirectory(pkg)
  }

  return IGNORED_DIRECTORIES.has(dirName)
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath))
}

function stripEslintCommentsFromContent(content) {
  let modified = content
  let removedCount = 0

  ESLINT_DIRECTIVE_PATTERNS.forEach((regex) => {
    const matches = modified.match(regex)
    if (matches) {
      removedCount += matches.length
    }
    modified = modified.replace(regex, "")
  })

  return {
    modified,
    removedCount,
  }
}

function walkAndCleanComments(rootDir) {
  const pkg = readPackageJson()
  let filesScanned = 0
  let filesTouched = 0
  let totalCommentsRemoved = 0

  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })

    entries.forEach((entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name, pkg)) return
        walk(entryPath)
        return
      }

      if (!entry.isFile()) return
      if (!isCodeFile(entryPath)) return

      filesScanned += 1
      const original = fs.readFileSync(entryPath, "utf8")
      const result = stripEslintCommentsFromContent(original)

      if (result.removedCount > 0) {
        fs.writeFileSync(entryPath, result.modified)
        filesTouched += 1
        totalCommentsRemoved += result.removedCount
      }
    })
  }

  walk(rootDir)

  return {
    filesScanned,
    filesTouched,
    totalCommentsRemoved,
  }
}

function printSummary(pmConfig, projectType, legacyPackages, commentStats) {
  console.log("")
  console.log(chalk.cyan("==============================================="))
  console.log(chalk.cyan("                    Summary"))
  console.log(chalk.cyan("==============================================="))
  console.log("")
  console.log(`Project type: ${projectType}`)
  console.log(`Package manager: ${pmConfig.id}`)
  console.log(`Biome version: ${BIOME_VERSION}`)
  console.log("")
  console.log(`Legacy ESLint/Prettier packages found: ${legacyPackages.length}`)
  console.log(`Files scanned for ESLint comments: ${commentStats.filesScanned}`)
  console.log(`Files updated: ${commentStats.filesTouched}`)
  console.log(
    `ESLint directive comments removed: ${commentStats.totalCommentsRemoved}`,
  )
  console.log("")
  console.log(chalk.green("Next steps:"))
  console.log(`  ${pmConfig.lint.run}`)
  console.log(`  ${pmConfig.lint.fix}`)
  console.log("")
}

async function promptForUpgrade(currentVersion) {
  return inquirer.prompt([
    {
      type: "list",
      name: "upgradeMode",
      message: `Biome ${currentVersion} is already installed. How would you like to upgrade to ${BIOME_VERSION}?`,
      choices: [
        {
          name: "Update version only (keep current biome.json)",
          value: "version",
        },
        {
          name: "Update version and overwrite biome.json with recommended config",
          value: "full",
        },
        {
          name: "Cancel",
          value: "cancel",
        },
      ],
    },
  ])
}

async function runUpgradeFlow(pmConfig, pkg, upgradeMode) {
  const projectType = inferProjectType(pkg)

  let useFracturedJson = false
  if (upgradeMode === "full") {
    const fjAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "useFracturedJson",
        message:
          "Use FracturedJson for JSON formatting? (intelligent inline/multi-line decisions, table-like alignment)",
        default: false,
      },
    ])
    useFracturedJson = fjAnswer.useFracturedJson
  }

  installBiome(pmConfig)

  if (upgradeMode === "full") {
    const config = createBiomeConfig(projectType, {
      ignoreNextDirectory: shouldIgnoreNextDirectory(pkg),
      fracturedJson: useFracturedJson,
    })
    fs.writeFileSync(PATHS.biomeConfig, `${JSON.stringify(config, null, 2)}\n`)
    logger.success(`Overwrote biome.json for project type: ${projectType}`)
    if (useFracturedJson) {
      logger.success(
        "JSON files excluded from Biome formatter (using FracturedJson instead)",
      )
    }
  } else {
    if (fs.existsSync(PATHS.biomeConfig)) {
      try {
        const raw = fs.readFileSync(PATHS.biomeConfig, "utf8")
        const config = JSON.parse(raw)
        if (config.$schema) {
          config.$schema = BIOME_SCHEMA_URL
          fs.writeFileSync(
            PATHS.biomeConfig,
            `${JSON.stringify(config, null, 2)}\n`,
          )
          logger.success("Updated $schema URL in biome.json")
        }
      } catch (_) {
        logger.warn("Could not update $schema in biome.json — skipping.")
      }
    }
  }

  if (useFracturedJson) {
    installFracturedJson(pmConfig)
    writeFormatJsonScript()
  }
  updatePackageJsonScripts(pmConfig, { fracturedJson: useFracturedJson })

  logger.step("Running lint:fix to apply Biome fixes...")
  runCommand(pmConfig.lint.fix)
  logger.success("Completed lint:fix.")

  console.log("")
  console.log(chalk.cyan("==============================================="))
  console.log(chalk.cyan("                    Summary"))
  console.log(chalk.cyan("==============================================="))
  console.log("")
  console.log(`Project type: ${projectType}`)
  console.log(`Package manager: ${pmConfig.id}`)
  console.log(`Biome upgraded: ${chalk.yellow(pkg._biomeCurrentVersion)} → ${chalk.green(BIOME_VERSION)}`)
  console.log(
    `Config: ${upgradeMode === "full" ? "overwritten with recommended config" : "kept existing (schema URL updated)"}`,
  )
  if (useFracturedJson) {
    console.log("JSON formatting: FracturedJson")
  }
  console.log("")
}

async function promptForSetup(legacyPackages) {
  return inquirer.prompt([
    {
      type: "confirm",
      name: "removeLegacy",
      message:
        "Remove all ESLint/Prettier related packages from package.json and node_modules?",
      default: true,
      when: () => legacyPackages.length > 0,
    },
    {
      type: "confirm",
      name: "cleanComments",
      message: "Remove ESLint directive comments from project files?",
      default: true,
    },
    {
      type: "confirm",
      name: "useFracturedJson",
      message:
        "Use FracturedJson for JSON formatting? (intelligent inline/multi-line decisions, table-like alignment)",
      default: false,
    },
  ])
}

async function main() {
  try {
    const pkg = readPackageJson()
    const pmConfig = detectPackageManager()
    const existingBiomeVersion = findExistingBiome(pkg)

    printBanner()

    logger.info(`Detected package manager: ${chalk.bold(pmConfig.id)}`)

    if (existingBiomeVersion) {
      if (existingBiomeVersion === BIOME_VERSION) {
        logger.success(
          `Biome is already at version ${BIOME_VERSION}. Nothing to upgrade.`,
        )
        return
      }

      logger.info(
        `Found existing Biome installation: ${chalk.bold(existingBiomeVersion)}`,
      )
      logger.info(`Latest version: ${chalk.bold(BIOME_VERSION)}`)
      console.log("")

      const { upgradeMode } = await promptForUpgrade(existingBiomeVersion)

      if (upgradeMode === "cancel") {
        logger.info("Upgrade cancelled.")
        return
      }

      pkg._biomeCurrentVersion = existingBiomeVersion
      await runUpgradeFlow(pmConfig, pkg, upgradeMode)
      return
    }

    const legacyPackages = findLegacyTools(pkg)
    const projectType = inferProjectType(pkg)

    logger.info(
      `Found ESLint/Prettier related packages: ${chalk.bold(
        String(legacyPackages.length),
      )}`,
    )
    if (legacyPackages.length > 0) {
      logger.info(`  ${legacyPackages.join(", ")}`)
    }
    logger.info(`Project type selected: ${chalk.bold(projectType)}`)
    console.log("")

    const answers = await promptForSetup(legacyPackages)

    if (legacyPackages.length > 0 && answers.removeLegacy) {
      uninstallLegacyTools(pmConfig, legacyPackages)
      const pkgAfter = readPackageJson()
      const cleaned = cleanEslintPrettierConfig(pkgAfter)
      if (cleaned) {
        writePackageJson(pkgAfter)
        logger.success(
          "Removed eslintConfig/prettier configuration from package.json.",
        )
      }
    } else if (legacyPackages.length > 0) {
      logger.warn("Keeping existing ESLint/Prettier packages as requested.")
    }

    installBiome(pmConfig)
    if (answers.useFracturedJson) {
      installFracturedJson(pmConfig)
      writeFormatJsonScript()
    }
    writeBiomeConfig(projectType, {
      fracturedJson: answers.useFracturedJson,
    })
    updatePackageJsonScripts(pmConfig, {
      fracturedJson: answers.useFracturedJson,
    })

    let commentStats = {
      filesScanned: 0,
      filesTouched: 0,
      totalCommentsRemoved: 0,
    }

    if (answers.cleanComments) {
      console.log("")
      logger.step(
        "Scanning project files and removing ESLint directive comments...",
      )
      commentStats = walkAndCleanComments(PROJECT_ROOT)
      logger.success("Finished cleaning ESLint comments.")
    }

    logger.step("Running lint:fix to apply Biome fixes...")
    runCommand(pmConfig.lint.fix)
    logger.success("Completed lint:fix.")

    printSummary(pmConfig, projectType, legacyPackages, commentStats)
  } catch (error) {
    if (error instanceof CliError) {
      logger.error(error.message)
    } else {
      logger.error("Unexpected error while running Biome setup:")
      console.error(error)
    }
    process.exit(1)
  }
}

main()
