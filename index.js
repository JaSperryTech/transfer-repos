#!/usr/bin/env node
import "dotenv/config";
import { Octokit } from "octokit";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ================= UTILS =================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function saveTokenToEnv(token) {
  console.log(chalk.blue("💾 [saveTokenToEnv] Saving token to .env..."));
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
    const lines = content.split("\n");
    const tokenLineIndex = lines.findIndex((line) =>
      line.startsWith("GITHUB_TOKEN="),
    );
    if (tokenLineIndex === -1) {
      lines.push(`GITHUB_TOKEN=${token}`);
    } else {
      lines[tokenLineIndex] = `GITHUB_TOKEN=${token}`;
    }
    content = lines.join("\n");
  } else {
    content = `GITHUB_TOKEN=${token}\n`;
  }
  fs.writeFileSync(envPath, content);
  console.log(chalk.green("✅ Token saved to .env"));
}

// ================= GITHUB API HELPERS =================
async function getAuthenticatedUser(octokit) {
  console.log(
    chalk.blue("👤 [getAuthenticatedUser] Fetching authenticated user..."),
  );
  const { data: user } = await octokit.request("GET /user");
  console.log(chalk.green(`👤 Authenticated user: ${user.login}`));
  return user.login;
}

async function getUserOrgs(octokit) {
  console.log(chalk.blue("🏢 [getUserOrgs] Fetching user organizations..."));
  const { data: orgs } = await octokit.request("GET /user/orgs", {
    per_page: 100,
  });
  const orgNames = orgs.map((org) => org.login);
  console.log(
    chalk.green(
      `🏢 Found ${orgNames.length} organizations: ${orgNames.join(", ")}`,
    ),
  );
  return orgNames;
}

async function fetchRepos(octokit, sourceType, sourceName) {
  console.log(
    chalk.blue(
      `📦 [fetchRepos] Fetching repos for ${sourceType} "${sourceName}"...`,
    ),
  );
  let repos;
  if (sourceType === "personal") {
    repos = await octokit.paginate("GET /user/repos", {
      affiliation: "owner",
      per_page: 100,
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
    });
  } else {
    repos = await octokit.paginate("GET /orgs/{org}/repos", {
      org: sourceName,
      per_page: 100,
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
    });
  }
  console.log(chalk.green(`📦 Fetched ${repos.length} repositories`));
  if (repos.length > 0) {
    console.log(
      chalk.dim(
        `   First 5: ${repos
          .slice(0, 5)
          .map((r) => r.name)
          .join(", ")}`,
      ),
    );
  }
  return repos;
}

// ================= ACTION HANDLERS =================
async function handleEdit(octokit, sourceName, selectedRepos) {
  console.log(chalk.blue("✏️ [handleEdit] Starting edit process..."));
  const { editAction } = await inquirer.prompt([
    {
      type: "rawlist",
      name: "editAction",
      message: "Choose edit action:",
      choices: [
        { name: "📦 Archive", value: "archive" },
        { name: "📂 Unarchive", value: "unarchive" },
        { name: "🔒 Make private", value: "make-private" },
        { name: "🌍 Make public", value: "make-public" },
        { name: "🏷️ Add topics", value: "add-topic" },
        { name: "📝 Set description", value: "set-description" },
      ],
    },
  ]);
  console.log(chalk.cyan(`✏️ Action selected: ${editAction}`));

  console.log(
    chalk.cyan(
      `\nYou selected ${selectedRepos.length} repositories for ${editAction}.`,
    ),
  );
  console.log(
    chalk.dim(`Selected repos: ${selectedRepos.map((r) => r.name).join(", ")}`),
  );

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Are you sure you want to proceed?"),
      default: false,
    },
  ]);
  if (!confirm) {
    console.log(chalk.yellow("Edit cancelled."));
    process.exit(0);
  }

  // For actions that need extra input, we ask once and reuse for all repos
  let topics = [];
  let description = "";
  if (editAction === "add-topic") {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "topics",
        message: "Enter topics (comma-separated):",
        validate: (input) => (input.trim() ? true : "Topics cannot be empty."),
      },
    ]);
    topics = answer.topics.split(",").map((t) => t.trim());
    console.log(chalk.dim(`Topics to add: ${topics.join(", ")}`));
  } else if (editAction === "set-description") {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "description",
        message: "Enter new description:",
      },
    ]);
    description = answer.description;
    console.log(chalk.dim(`New description: ${description}`));
  }

  // Helper to perform an action with temporary unarchive if needed
  const performWithTempUnarchive = async (repo, action) => {
    const wasArchived = repo.archived;
    const needsUnarchive =
      wasArchived && !["archive", "unarchive"].includes(action);

    if (needsUnarchive) {
      // Step 1: Unarchive
      await octokit.request("PATCH /repos/{owner}/{repo}", {
        owner: sourceName,
        repo: repo.name,
        archived: false,
      });
    }

    // Step 2: Perform the requested action
    switch (action) {
      case "archive":
        // If already archived, nothing to do
        if (!wasArchived) {
          await octokit.request("PATCH /repos/{owner}/{repo}", {
            owner: sourceName,
            repo: repo.name,
            archived: true,
          });
        }
        break;
      case "unarchive":
        // Already handled above if needed, but if repo wasn't archived, nothing to do
        if (wasArchived) {
          await octokit.request("PATCH /repos/{owner}/{repo}", {
            owner: sourceName,
            repo: repo.name,
            archived: false,
          });
        }
        break;
      case "make-private":
        await octokit.request("PATCH /repos/{owner}/{repo}", {
          owner: sourceName,
          repo: repo.name,
          private: true,
        });
        break;
      case "make-public":
        await octokit.request("PATCH /repos/{owner}/{repo}", {
          owner: sourceName,
          repo: repo.name,
          private: false,
        });
        break;
      case "add-topic":
        await octokit.request("PUT /repos/{owner}/{repo}/topics", {
          owner: sourceName,
          repo: repo.name,
          names: topics,
        });
        break;
      case "set-description":
        await octokit.request("PATCH /repos/{owner}/{repo}", {
          owner: sourceName,
          repo: repo.name,
          description: description,
        });
        break;
    }

    // Step 3: Re-archive if it was originally archived and action isn't "unarchive"
    if (needsUnarchive) {
      await octokit.request("PATCH /repos/{owner}/{repo}", {
        owner: sourceName,
        repo: repo.name,
        archived: true,
      });
    }
  };

  for (const repo of selectedRepos) {
    const spinner = ora(`Processing ${chalk.cyan(repo.name)}...`).start();
    try {
      console.log(
        chalk.dim(`   [handleEdit] Processing ${repo.name} (${editAction})`),
      );

      // If the repo is archived and we're trying to archive it, just succeed without API call
      if (editAction === "archive" && repo.archived) {
        spinner.succeed(chalk.green(`Already archived: ${repo.name}`));
        continue;
      }

      // If the repo is not archived and we're trying to unarchive, just succeed
      if (editAction === "unarchive" && !repo.archived) {
        spinner.succeed(chalk.green(`Already unarchived: ${repo.name}`));
        continue;
      }

      await performWithTempUnarchive(repo, editAction);
      spinner.succeed(chalk.green(`Success: ${repo.name}`));
      await delay(500);
    } catch (error) {
      spinner.fail(chalk.red(`Failed to edit ${repo.name}: ${error.message}`));
      console.error(chalk.red(`[handleEdit] Error details:`, error));
    }
  }
  console.log(chalk.green.bold("\n✅ Edit process completed!\n"));
}

async function handleTransfer(octokit, sourceName, selectedRepos) {
  console.log(chalk.blue("📤 [handleTransfer] Starting transfer process..."));
  const { target } = await inquirer.prompt([
    {
      type: "input",
      name: "target",
      message: "Enter the target GitHub username or organization:",
      validate: (input) => (input ? true : "Target cannot be empty."),
    },
  ]);
  console.log(chalk.cyan(`📤 Target: ${target}`));

  console.log(
    chalk.cyan(
      `\nYou selected ${selectedRepos.length} repositories for transfer to ${target}.`,
    ),
  );
  console.log(
    chalk.dim(`Selected repos: ${selectedRepos.map((r) => r.name).join(", ")}`),
  );

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: chalk.yellow("Are you sure you want to proceed?"),
      default: false,
    },
  ]);
  if (!confirm) {
    console.log(chalk.yellow("Transfer cancelled."));
    process.exit(0);
  }

  for (const repo of selectedRepos) {
    const spinner = ora(`Transferring ${chalk.cyan(repo.name)}...`).start();
    try {
      console.log(
        chalk.dim(`   [handleTransfer] Transferring ${repo.name} to ${target}`),
      );
      await octokit.request("POST /repos/{owner}/{repo}/transfer", {
        owner: sourceName,
        repo: repo.name,
        new_owner: target,
      });
      spinner.succeed(chalk.green(`Transferred: ${repo.name} → ${target}`));
      await delay(1000);
    } catch (error) {
      spinner.fail(
        chalk.red(`Failed to transfer ${repo.name}: ${error.message}`),
      );
      console.error(chalk.red(`[handleTransfer] Error details:`, error));
    }
  }
  console.log(chalk.green.bold("\n✅ Transfer process completed!\n"));
}

// ================= MAIN =================
async function main() {
  console.log(chalk.bold.cyan("\n🚀 GitHub Repository Manager\n"));
  console.log(chalk.blue("[main] Script started"));

  // --- Token handling ---
  let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (GITHUB_TOKEN) {
    console.log(chalk.green("🔑 GitHub token found in .env"));
  } else {
    console.log(chalk.yellow("🔑 No GitHub token found in .env"));
    const { token, saveToken } = await inquirer.prompt([
      {
        type: "password",
        name: "token",
        message: "Enter your GitHub personal access token:",
        validate: (input) => (input ? true : "Token cannot be empty."),
      },
      {
        type: "confirm",
        name: "saveToken",
        message: "Save this token to .env for future use?",
        default: true,
      },
    ]);
    GITHUB_TOKEN = token;
    if (saveToken) saveTokenToEnv(token);
  }

  // --- Authenticate ---
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  let userLogin, userOrgs;
  try {
    const spinner = ora("Authenticating...").start();
    userLogin = await getAuthenticatedUser(octokit);
    userOrgs = await getUserOrgs(octokit);
    spinner.succeed(chalk.green(`Authenticated as ${chalk.bold(userLogin)}`));
  } catch (error) {
    console.error(chalk.red("❌ Authentication failed:"), error.message);
    console.error(chalk.red(error.stack));
    process.exit(1);
  }

  // --- Choose source ---
  const sourceChoices = [
    {
      name: `Personal account: ${userLogin}`,
      value: { type: "personal", name: userLogin },
    },
    ...userOrgs.map((org) => ({
      name: `Organization: ${org}`,
      value: { type: "organization", name: org },
    })),
  ];
  console.log(chalk.blue("[main] Source choices:"));
  sourceChoices.forEach((choice, i) => {
    console.log(
      chalk.dim(
        `   ${i + 1}: ${choice.name} (${JSON.stringify(choice.value)})`,
      ),
    );
  });

  const { source: selectedValue } = await inquirer.prompt([
    {
      type: "rawlist", // using rawlist to avoid rendering issues on some terminals
      name: "source",
      message: "Which repositories do you want to manage?",
      choices: sourceChoices,
    },
  ]);
  console.log(
    chalk.green(
      `[main] Selected source value: ${JSON.stringify(selectedValue)}`,
    ),
  );

  const { type: sourceType, name: sourceName } = selectedValue;

  console.log(
    chalk.dim(
      `\n📁 Source: ${sourceType === "personal" ? "Personal" : "Organization"} (${sourceName})`,
    ),
  );

  // --- Fetch repositories ---
  const fetchSpinner = ora(
    `Fetching repositories from ${chalk.cyan(sourceName)}...`,
  ).start();
  let repos;
  try {
    repos = await fetchRepos(octokit, sourceType, sourceName);
    fetchSpinner.succeed(chalk.green(`Found ${repos.length} repositories.`));
  } catch (error) {
    fetchSpinner.fail(chalk.red("Failed to fetch repositories."));
    console.error(chalk.red(error.message));
    console.error(chalk.red(error.stack));
    process.exit(1);
  }

  if (repos.length === 0) {
    console.log(chalk.yellow("No repositories found. Exiting."));
    process.exit(0);
  }

  // --- Choose action ---
  const { action } = await inquirer.prompt([
    {
      type: "rawlist",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "✏️ Edit repositories", value: "edit" },
        { name: "📤 Transfer repositories", value: "transfer" },
      ],
    },
  ]);
  console.log(chalk.cyan(`[main] Action chosen: ${action}`));

  // Sort repositories alphabetically (case‑insensitive) for consistency
  const sortedRepos = [...repos].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  // Find the longest repository name to align the tags
  const maxNameLength = Math.max(...sortedRepos.map((r) => r.name.length));

  const { selectedRepos } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedRepos",
      message: "Select repositories:",
      choices: sortedRepos.map((repo) => ({
        name: `${repo.name.padEnd(maxNameLength)} (${repo.private ? chalk.red("🔒 private") : chalk.green("🌍 public")})${repo.archived ? chalk.gray(" [archived]") : ""}`,
        value: repo,
        checked: false,
      })),
      validate: (answer) =>
        answer.length > 0 ? true : "You must select at least one repository.",
    },
  ]);

  console.log(
    chalk.green(
      `[main] Selected ${selectedRepos.length} repositories: ${selectedRepos.map((r) => r.name).join(", ")}`,
    ),
  );

  // --- Dispatch action ---
  if (action === "edit") {
    await handleEdit(octokit, sourceName, selectedRepos);
  } else {
    await handleTransfer(octokit, sourceName, selectedRepos);
  }

  console.log(chalk.blue("[main] Script finished successfully"));
}

// --- Top-level await with error handling ---
try {
  await main();
} catch (error) {
  console.error(chalk.red("Unexpected error:"), error);
  console.error(chalk.red(error.stack));
  process.exit(1);
}
