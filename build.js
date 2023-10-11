import fs from 'node:fs/promises';
import {Octokit} from '@octokit/rest';
import {throttling} from '@octokit/plugin-throttling';

async function* iterateIssues(octokit, owner, repo) {
  for await (const response of octokit.paginate.iterator(
      octokit.rest.issues.listForRepo,
      {
        owner,
        repo,
        per_page: 100,
      },
  )) {
    for (const issue of response.data) {
      yield issue;
    }
  }
}

async function* iterateReactions(octokit, owner, repo, issue_number) {
  for await (const response of octokit.paginate.iterator(
    octokit.rest.reactions.listForIssue,
      {
        owner,
        repo,
        issue_number,
        per_page: 100,
      },
  )) {
    for (const reaction of response.data) {
      yield reaction;
    }
  }
}

async function main() {
  const ThrottlingOctokit = Octokit.plugin(throttling);

  const octokit = new ThrottlingOctokit({
    auth: process.env.GITHUB_TOKEN,
    throttle: {
      onRateLimit: (retryAfter, options) => {
        console.log('');
        if (options.request.retryCount <= 2) {
          console.warn(`Rate limiting triggered, retrying after ${retryAfter} seconds!`);
          return true;
        } else {
          console.error(`Rate limiting triggered, not retrying again!`);
        }
      },
      onAbuseLimit: () => {
        console.error('Abuse limit triggered, not retrying!');
      },
    },
  });

  const repos = new Set(['https://github.com/web-platform-tests/interop']);

  // Collect all issues into an array. This will be used to generate HTML/JSON.
  const issues = [];

  for (const repoURL of Array.from(repos).sort()) {
    const url = new URL(repoURL);
    if (url.hostname !== 'github.com') {
      continue;
    }
    const parts = url.pathname.split('/').filter((s) => s);
    if (parts.length !== 2) {
      continue;
    }

    const [owner, repo] = parts;
    for await (const issue of iterateIssues(octokit, owner, repo)) {
      const label = issue.labels.find((label) => {
        switch (label.name) {
        case 'focus-area-proposal':
        case 'investigation-effort-proposal':
          return label;
        }
        return undefined;
      });
      if (!label) {
        continue;
      }
      const info = {
        total_count: issue.reactions.total_count,
        url: issue.html_url,
        title: issue.title,
        label: label.name,
      };
      // Log the issue URL to make it easier to see if the script is stuck.
      console.log(info.url);
      issues.push(info);
    }
  }

  // Write JSON output.
  const json = JSON.stringify(issues, null, '  ') + '\n';
  await fs.writeFile('issues.json', json);
}

await main();
