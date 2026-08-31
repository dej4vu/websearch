import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { registerFetchCommand } from "./commands/fetch.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerBingFetchCommand } from "./commands/bing-fetch.js";

export async function run(argv) {
  const program = new Command();

  program
    .name("websearch")
    .description("Agent-oriented web tools for fetching pages and searching Bing CN.")
    .version(packageJson.version, "--version", "Show the CLI version.")
    .helpOption("-h, --help", "Show help.")

  registerFetchCommand(program);
  registerSearchCommand(program);
  registerBingFetchCommand(program);

  await program.parseAsync(argv, { from: "user" });
  return process.exitCode ?? 0;
}
