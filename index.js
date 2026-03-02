import { Octokit } from "octokit"

// Configuration
const GITHUB_TOKEN = ""
const SOURCE_USERNAME = "jsperry0807-rgb"  // Account you're moving FROM
const TARGET_ORG = "JaSperryTech"   // Organization you're moving TO

const octokit = new Octokit({ auth: GITHUB_TOKEN })

async function transferAllRepos() {
  try {
    // 1. Get all repos from your account
    const repos = await octokit.paginate("GET /user/repos", {
      affiliation: "owner",
      per_page: 100,
      headers: { "X-GitHub-Api-Version": "2022-11-28" }
    })

    console.log(`Found ${repos.length} repositories to transfer`)

    // 2. Transfer each repo
    for (const repo of repos) {
      console.log(`Transferring ${repo.name}...`)
      
      try {
        await octokit.request("POST /repos/{owner}/{repo}/transfer", {
          owner: SOURCE_USERNAME,
          repo: repo.name,
          new_owner: TARGET_ORG,
          headers: { "X-GitHub-Api-Version": "2022-11-28" }
        })
        console.log(`✅ ${repo.name} transferred successfully`)
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`❌ Failed to transfer ${repo.name}:`, error.message)
      }
    }
    
    console.log("Transfer process complete!")
    
  } catch (error) {
    console.error("Error fetching repositories:", error)
  }
}

transferAllRepos()