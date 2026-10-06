// Reproducible download of the unmodified upstream Inter 4.1 web fonts.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
async function main() {
  const destination = path.resolve(__dirname, '../apps/desktop/src/renderer/assets/fonts');
  const fonts = {
    'InterVariable.woff2': '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',
    'InterVariable-Italic.woff2': 'e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a',
  };
  for (const [file, expectedHash] of Object.entries(fonts)) {
    const response = await fetch(`https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/${file}`);
    if (!response.ok) throw new Error(`Inter download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error('Not a WOFF2 font');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== expectedHash) throw new Error(`Unexpected Inter checksum: ${file}`);
    await fs.writeFile(path.join(destination, file), bytes);
    console.log(`${file}: ${bytes.length} bytes, SHA256 ${hash}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
