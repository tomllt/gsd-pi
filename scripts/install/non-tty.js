export function assertInteractiveOrYes({ isTTY, yesFlag }) {
  if (isTTY || yesFlag) return
  process.stderr.write(
    'Error: Interactive installer requires a terminal.\n\n' +
    'For automated installs:\n' +
    '  npx @opengsd/gsd-pi@latest --yes\n\n' +
    'Or install directly:\n' +
    '  npm install -g @opengsd/gsd-pi\n\n',
  )
  process.exit(1)
}

export function printNonInteractiveNextSteps() {
  process.stdout.write(
    '\nInstalled. Run:\n' +
    '  gsd config   # configure LLM provider\n' +
    '  gsd          # start agent\n\n' +
    'Docs: https://opengsd.net\n\n',
  )
}
