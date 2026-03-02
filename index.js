#!/usr/bin/env node
import 'dotenv/config';
import { Octokit } from "octokit";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ================= UTILS =================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function saveTokenToEnv(token) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const tokenLineIndex = lines.findIndex(line => line.startsWith('GITHUB_TOKEN='));
    if (tokenLineIndex !== -1) {
      lines[tokenLineIndex] = `GITHUB_TOKEN=${token}`;
    } else {
      lines.push(`GITHUB_TOKEN=${token}`);
    }
    content = lines.join('\n');
  } else {
    content = `GITHUB_TOKEN=${token}\n`;
  }
  fs.writeFileSync(envPath, content);
  console.log(chalk.green('✅ Token saved to .env'));
}

// ================= MAIN =================
async function main() {
  console.log(chalk.bold.cyan('\n🚀 GitHub Repository Manager\n'));

  // --- Step 1: GitHub Token ---
  let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.log(chalk.yellow('🔑 No GitHub token found in .env'));
    const { token, saveToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Enter your GitHub personal access token:',
        validate: input => input ? true : 'Token cannot be empty.'
      },
      {
        type: 'confirm',
        name: 'saveToken',
        message: 'Save this token to .env for future use?',
        default: true
      }
    ]);
    GITHUB_TOKEN = token;
    if (saveToken) {
      saveTokenToEnv(token);
    }
  }

  // --- Step 2: Authenticate and fetch user info ---
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  let userLogin, userOrgs = [];
  try {
    const spinner = ora('Authenticating...').start();
    const { data: user } = await octokit.request('GET /user');
    userLogin = user.login;
    const { data: orgs } = await octokit.request('GET /user/orgs', { per_page: 100 });
    userOrgs = orgs.map(org => org.login);
    spinner.succeed(chalk.green(`Authenticated as ${chalk.bold(userLogin)}`));
  } catch (error) {
    console.error(chalk.red('❌ Authentication failed:'), error.message);
    process.exit(1);
  }

  // --- Step 3: Choose source (personal or organization) ---
  const sourceChoices = [
    {
      name: `Personal account: ${userLogin}`,
      value: { type: 'personal', name: userLogin }
    },
    ...userOrgs.map(org => ({
      name: `Organization: ${org}`,
      value: { type: 'organization', name: org }
    }))
  ];
  console.log(sourceChoices)
  const { source } = await inquirer.prompt([
    {
      type: 'list',
      name: 'source',
      message: 'Which repositories do you want to manage?',
      choices: sourceChoices
    }
  ]);
  const selectedSource = sourceChoices.find(c => c.name === source).value;
  const sourceType = selectedSource.type;
  const sourceName = selectedSource.name;
  console.log(chalk.dim(`\n📁 Source: ${sourceType === 'personal' ? 'Personal' : 'Organization'} (${sourceName})`));

  // --- Step 4: Fetch repositories from the chosen source ---
  const fetchSpinner = ora(`Fetching repositories from ${chalk.cyan(sourceName)}...`).start();
  let repos;
  try {
    if (sourceType === 'personal') {
      repos = await octokit.paginate('GET /user/repos', {
        affiliation: 'owner',
        per_page: 100,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' }
      });
    } else {
      repos = await octokit.paginate('GET /orgs/{org}/repos', {
        org: sourceName,
        per_page: 100,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' }
      });
    }
    fetchSpinner.succeed(chalk.green(`Found ${repos.length} repositories.`));
  } catch (error) {
    fetchSpinner.fail(chalk.red('Failed to fetch repositories.'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  if (repos.length === 0) {
    console.log(chalk.yellow('No repositories found. Exiting.'));
    process.exit(0);
  }

  // --- Step 5: Choose action (edit or transfer) ---
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '✏️ Edit repositories', value: 'edit' },
        { name: '📤 Transfer repositories', value: 'transfer' }
      ]
    }
  ]);

  // --- Step 6: Select repositories (checkbox) ---
  const { selectedRepos } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedRepos',
      message: 'Select repositories:',
      choices: repos.map(repo => ({
        name: `${repo.name} (${repo.private ? '🔒 private' : '🌍 public'})${repo.archived ? ' [archived]' : ''}`,
        value: repo,
        checked: false
      })),
      validate: answer => answer.length > 0 ? true : 'You must select at least one repository.'
    }
  ]);

  // --- Step 7: Handle the chosen action ---
  if (action === 'edit') {
    // --- Edit action selection ---
    const { editAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'editAction',
        message: 'Choose edit action:',
        choices: [
          { name: '📦 Archive', value: 'archive' },
          { name: '📂 Unarchive', value: 'unarchive' },
          { name: '🔒 Make private', value: 'make-private' },
          { name: '🌍 Make public', value: 'make-public' },
          { name: '🏷️ Add topics', value: 'add-topic' },
          { name: '📝 Set description', value: 'set-description' }
        ]
      }
    ]);

    // --- Confirmation ---
    console.log(chalk.cyan(`\nYou selected ${selectedRepos.length} repositories for ${editAction}.`));
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('Are you sure you want to proceed?'),
        default: false
      }
    ]);
    if (!confirm) {
      console.log(chalk.yellow('Edit cancelled.'));
      process.exit(0);
    }

    // --- Perform edits ---
    for (const repo of selectedRepos) {
      const spinner = ora(`Processing ${chalk.cyan(repo.name)}...`).start();
      try {
        switch (editAction) {
          case 'archive':
            await octokit.request('PATCH /repos/{owner}/{repo}', {
              owner: sourceName,
              repo: repo.name,
              archived: true,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Archived: ${repo.name}`));
            break;

          case 'unarchive':
            await octokit.request('PATCH /repos/{owner}/{repo}', {
              owner: sourceName,
              repo: repo.name,
              archived: false,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Unarchived: ${repo.name}`));
            break;

          case 'make-private':
            await octokit.request('PATCH /repos/{owner}/{repo}', {
              owner: sourceName,
              repo: repo.name,
              private: true,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Made private: ${repo.name}`));
            break;

          case 'make-public':
            await octokit.request('PATCH /repos/{owner}/{repo}', {
              owner: sourceName,
              repo: repo.name,
              private: false,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Made public: ${repo.name}`));
            break;

          case 'add-topic':
            // Prompt for topics only once (same topics for all selected repos)
            const { topics } = await inquirer.prompt([{
              type: 'input',
              name: 'topics',
              message: `Enter topics for ${chalk.cyan(repo.name)} (comma-separated):`,
              validate: input => input.trim() ? true : 'Topics cannot be empty.'
            }]);
            const topicList = topics.split(',').map(t => t.trim());
            await octokit.request('PUT /repos/{owner}/{repo}/topics', {
              owner: sourceName,
              repo: repo.name,
              names: topicList,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Topics added to: ${repo.name}`));
            break;

          case 'set-description':
            const { description } = await inquirer.prompt([{
              type: 'input',
              name: 'description',
              message: `Enter new description for ${chalk.cyan(repo.name)}:`
            }]);
            await octokit.request('PATCH /repos/{owner}/{repo}', {
              owner: sourceName,
              repo: repo.name,
              description: description,
              headers: { 'X-GitHub-Api-Version': '2022-11-28' }
            });
            spinner.succeed(chalk.green(`Description updated: ${repo.name}`));
            break;
        }
        await delay(500); // be kind to GitHub API
      } catch (error) {
        spinner.fail(chalk.red(`Failed to edit ${repo.name}: ${error.message}`));
      }
    }
    console.log(chalk.green.bold('\n✅ Edit process completed!\n'));

  } else if (action === 'transfer') {
    // --- Transfer: ask for target ---
    const { target } = await inquirer.prompt([
      {
        type: 'input',
        name: 'target',
        message: 'Enter the target GitHub username or organization:',
        validate: input => input ? true : 'Target cannot be empty.'
      }
    ]);

    console.log(chalk.cyan(`\nYou selected ${selectedRepos.length} repositories for transfer to ${target}.`));
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.yellow('Are you sure you want to proceed?'),
        default: false
      }
    ]);
    if (!confirm) {
      console.log(chalk.yellow('Transfer cancelled.'));
      process.exit(0);
    }

    // --- Perform transfers ---
    for (const repo of selectedRepos) {
      const spinner = ora(`Transferring ${chalk.cyan(repo.name)}...`).start();
      try {
        await octokit.request('POST /repos/{owner}/{repo}/transfer', {
          owner: sourceName,
          repo: repo.name,
          new_owner: target,
          headers: { 'X-GitHub-Api-Version': '2022-11-28' }
        });
        spinner.succeed(chalk.green(`Transferred: ${repo.name} → ${target}`));
        await delay(1000);
      } catch (error) {
        spinner.fail(chalk.red(`Failed to transfer ${repo.name}: ${error.message}`));
      }
    }
    console.log(chalk.green.bold('\n✅ Transfer process completed!\n'));
  }

  process.exit(0);
}

// Run
main().catch(error => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});