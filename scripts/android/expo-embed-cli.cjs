// Gradle appends --verbose after extraPackagerArgs, but Expo export:embed
// requires the positional projectRoot to be the final CLI argument.
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

function withExpoProjectRoot(argv) {
  const args = [...argv];
  if (args[2] !== "export:embed") throw new Error("Only Expo export:embed is supported");
  const marker = args.indexOf("--hotpot-project-root");
  if (marker < 0 || !args[marker + 1]) throw new Error("Missing explicit app root");
  const projectRoot = resolve(args[marker + 1]);
  if (!existsSync(join(projectRoot, "package.json")) || !existsSync(join(projectRoot, "index.ts"))) {
    throw new Error("Invalid Expo Android app root: " + projectRoot);
  }
  args.splice(marker, 2);
  args.push(projectRoot); // Positional path must follow Gradle's --verbose.
  return { args, projectRoot };
}

module.exports = { withExpoProjectRoot };

if (require.main === module) {
  const { args, projectRoot } = withExpoProjectRoot(process.argv);
  process.argv = args;
  const expoPkg = require.resolve("expo/package.json", { paths: [projectRoot] });
  const cliPath = require.resolve("@expo/cli", { paths: [expoPkg] });
  require(cliPath);
}
