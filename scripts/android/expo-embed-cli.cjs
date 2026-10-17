// Expo Metro's server root is the npm workspace, while React Native Gradle
// passes --entry-file relative to each app. Normalize both roots before embedding.
// Also put the Expo positional projectRoot AFTER Gradle's trailing --verbose.
const { existsSync } = require("node:fs");
const { isAbsolute, join, relative, resolve } = require("node:path");

function withExpoProjectRoot(argv, metroServerRoot) {
  const args = [...argv];
  if (args[2] !== "export:embed") throw new Error("Only Expo export:embed is supported");
  const marker = args.indexOf("--hotpot-project-root");
  if (marker < 0 || !args[marker + 1]) throw new Error("Missing explicit app root");
  const projectRoot = resolve(args[marker + 1]);
  if (!existsSync(join(projectRoot, "package.json")) || !existsSync(join(projectRoot, "index.ts"))) {
    throw new Error("Invalid Expo Android app root: " + projectRoot);
  }
  const entryArg = args.indexOf("--entry-file");
  if (entryArg < 0 || !args[entryArg + 1]) throw new Error("Missing Expo --entry-file");
  const entryPath = resolve(projectRoot, args[entryArg + 1]);
  if (!existsSync(entryPath)) throw new Error("Missing native entry: " + entryPath);
  // Expo SDK 54's getMetroServerRoot uses the workspace root in a monorepo.
  // Its Metro server resolves --entry-file relative to THAT root, not the app.
  const root = metroServerRoot || require(require.resolve("@expo/config/paths", {
    paths: [projectRoot],
  })).getMetroServerRoot(projectRoot);
  const relativeEntry = relative(root, entryPath).replace(/\\/g, "/");
  if (!relativeEntry || relativeEntry.startsWith("../") || isAbsolute(relativeEntry)) {
    throw new Error("Expo entry escapes Metro server root: " + relativeEntry);
  }
  args[entryArg + 1] = relativeEntry;
  args.splice(marker, 2);
  args.push(projectRoot); // Positional path must follow Gradle's --verbose.
  return { args, projectRoot };
}

module.exports = { withExpoProjectRoot };

if (require.main === module) {
  const { args, projectRoot } = withExpoProjectRoot(process.argv);
  console.log("Expo Android embed entry: " + args[args.indexOf("--entry-file") + 1]);
  process.argv = args;
  const expoPkg = require.resolve("expo/package.json", { paths: [projectRoot] });
  const cliPath = require.resolve("@expo/cli", { paths: [expoPkg] });
  require(cliPath);
}
