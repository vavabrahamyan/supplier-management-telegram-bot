const major = Number(process.versions.node.split('.')[0]);
if (major !== 24) {
  console.error(`Node.js 24 is required; found ${process.version}. Install and select Node.js 24, then try again.`);
  process.exitCode = 1;
}
