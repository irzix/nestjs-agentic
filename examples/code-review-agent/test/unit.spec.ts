import { execSync } from 'node:child_process';

const testFiles = [
  'dist/test/test/task-01-ingress.spec.js',
  'dist/test/test/task-02-rag.spec.js',
  'dist/test/test/task-03-agents.spec.js',
  'dist/test/test/task-04-orchestration.spec.js',
  'dist/test/test/task-05-governance.spec.js',
  'dist/test/test/task-06-evaluation.spec.js',
  'dist/test/test/task-07-memory.spec.js',
  'dist/test/test/njent-e2e.spec.js',
];

console.log('🧪 Executing all 8 Njent Test Suites...\n');

for (const file of testFiles) {
  console.log(`\n========================================`);
  console.log(`Running: ${file}`);
  console.log(`========================================`);
  execSync(`node ${file}`, { stdio: 'inherit' });
}

console.log('\n🌟 ALL 8 NJENT TEST SUITES COMPLETED WITH 100% SUCCESS!\n');
