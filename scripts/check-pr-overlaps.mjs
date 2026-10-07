import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeAnnotation, findPrOverlaps, renderOverlapReport } from "./lib/pr-overlap.mjs";

export function loadOpenPulls(repository, api) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new Error("Invalid GitHub repository name");
  const pulls = api(`repos/${repository}/pulls?state=open&per_page=100`, true).flat();
  return pulls.map((pull) => {
    if (!Number.isSafeInteger(pull.number) || pull.number <= 0) throw new Error("Invalid pull request number");
    const detail = api(`repos/${repository}/pulls/${pull.number}`, false);
    const files = api(`repos/${repository}/pulls/${pull.number}/files?per_page=100`, true).flat();
    return { number: pull.number, base: pull.base.ref, head: pull.head.ref, headRepository: pull.head.repo?.full_name || repository,
      files: files.map(({ filename, previous_filename }) => ({ filename, previous_filename })),
      incomplete: detail.changed_files > files.length };
  });
}

function command(program, args) {
  return execFileSync(program, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function run() {
  const repository = process.env.GITHUB_REPOSITORY || command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const api = (path, pages) => JSON.parse(command("gh", ["api", path, ...(pages ? ["--paginate", "--slurp"] : [])]));
  let pulls = loadOpenPulls(repository, api);
  if (process.argv.includes("--local")) {
    const branch = command("git", ["branch", "--show-current"]);
    const base = command("git", ["merge-base", "HEAD", "origin/main"]);
    const paths = [command("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`]),
      command("git", ["diff", "--name-only", "--no-renames", "-z", "HEAD"]), command("git", ["ls-files", "--others", "--exclude-standard", "-z"])]
      .flatMap((output) => output.split("\0")).filter(Boolean);
    pulls = pulls.filter((pull) => pull.head !== branch || pull.headRepository.toLowerCase() !== repository.toLowerCase());
    pulls.push({ number: 0, base: "main", files: [...new Set(paths)].map((filename) => ({ filename })) });
  }
  const pairs = findPrOverlaps(pulls);
  const report = renderOverlapReport(repository, pulls, pairs);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (process.env.GITHUB_ACTIONS) for (const pair of pairs) {
    console.log(`::warning title=Пересечение PR::${escapeAnnotation(`PR ${pair.left} и PR ${pair.right}: ${pair.files.length} общих файлов. Согласуйте изменения; создание PR не блокируется.`)}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); }
  catch {
    const message = "Проверка пересечений не выполнена: проверьте gh auth status, доступ к репозиторию и сеть. Отсутствие отчёта не означает отсутствие пересечений.";
    console.error(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Параллельные PR\n\n${message}\n`);
    // Advisory only. Never make an independent feature's required CI red for this report.
  }
}
