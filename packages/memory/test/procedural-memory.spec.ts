import {
  ProceduralMemoryStore,
  type ProceduralPlaybook,
} from '../src';

export async function runProceduralMemoryTests() {
  console.log('⚡ Running Procedural Memory & SOP Playbook Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // 1. Save and Retrieve Playbook
  try {
    const store = new ProceduralMemoryStore();
    const playbook: ProceduralPlaybook = {
      id: 'pb_pr_review',
      name: 'Pull Request Security & Governance Audit',
      description: 'Audit PR code for OWASP vulnerabilities and licensing compliance',
      version: '1.2.0',
      triggers: ['code_review', 'pull_request', 'security_audit'],
      prerequisites: ['read_access', 'tool:git_diff'],
      steps: [
        {
          stepNumber: 1,
          title: 'Extract Git Diff',
          description: 'Fetch changed files and lines from target pull request',
          toolName: 'get_pr_diff',
          validationCondition: 'Diff must be non-empty',
          onFailure: 'abort',
        },
        {
          stepNumber: 2,
          title: 'Static Security Analysis',
          description: 'Scan diff for hardcoded credentials, eval statements, and sql injection',
          toolName: 'ast_security_scan',
          onFailure: 'escalate_hitl',
        },
        {
          stepNumber: 3,
          title: 'Format Review Comment',
          description: 'Publish structured GitHub PR review summary with verdict',
          toolName: 'post_pr_review',
        },
      ],
    };

    await store.savePlaybook(playbook);

    const retrieved = await store.getPlaybook('pb_pr_review');
    assert(retrieved !== null, 'Playbook successfully retrieved by ID');
    assert(retrieved?.name === 'Pull Request Security & Governance Audit', 'Playbook name matches');
    assert(retrieved?.steps.length === 3, 'All 3 procedural steps preserved');
    assert(retrieved?.steps[1].onFailure === 'escalate_hitl', 'Error recovery strategy preserved');
  } catch (err: unknown) {
    assert(false, 'Save and retrieve playbook', String(err));
  }

  // 2. Playbook Matching and Ranking
  try {
    const store = new ProceduralMemoryStore();
    await store.savePlaybook({
      id: 'pb_deploy',
      name: 'Production Deployment Workflow',
      description: 'Automated release deployment to Kubernetes cluster',
      triggers: ['deploy', 'release', 'production'],
      steps: [{ stepNumber: 1, title: 'Apply Helm Chart', description: 'Deploy pods' }],
    });
    await store.savePlaybook({
      id: 'pb_migration',
      name: 'Postgres Database Migration',
      description: 'Run TypeORM or Prisma migration scripts safely',
      triggers: ['database', 'migration', 'schema_change'],
      steps: [{ stepNumber: 1, title: 'Run Migrate', description: 'Apply DDL' }],
    });

    const matches = await store.matchPlaybooks('deploy to production');
    assert(matches.length === 1, 'Matched 1 playbook for deploy trigger');
    assert(matches[0].playbook.id === 'pb_deploy', 'Deployment playbook matched');
    assert(matches[0].matchScore >= 0.85, 'High match score for direct trigger match');

    // Multi-trigger lookup
    const multiMatches = await store.matchPlaybooks(['schema_change', 'database']);
    assert(multiMatches.length === 1, 'Database migration matched for multiple triggers');
    assert(multiMatches[0].playbook.id === 'pb_migration', 'Migration playbook matched');
  } catch (err: unknown) {
    assert(false, 'Playbook matching and ranking', String(err));
  }

  // 3. Playbook Instruction Formatting
  try {
    const store = new ProceduralMemoryStore();
    const formatted = store.formatPlaybookInstructions({
      id: 'pb_sample',
      name: 'Sample Playbook',
      version: '2.0',
      description: 'Sample operational goal',
      triggers: ['sample'],
      prerequisites: ['admin_role'],
      steps: [
        {
          stepNumber: 1,
          title: 'First Step',
          description: 'Do something important',
          toolName: 'sample_tool',
          validationCondition: 'status === ok',
          onFailure: 'retry',
        },
      ],
    });

    assert(formatted.includes('### Standard Operating Procedure: Sample Playbook (v2.0)'), 'Header formatted with version');
    assert(formatted.includes('**Prerequisites:** admin_role'), 'Prerequisites formatted');
    assert(formatted.includes('[Tool: `sample_tool`]'), 'Tool tag formatted');
    assert(formatted.includes('*Validation Criteria:* status === ok'), 'Validation criteria formatted');
    assert(formatted.includes('*On Failure:* `retry`'), 'Error recovery formatted');
  } catch (err: unknown) {
    assert(false, 'Playbook instruction formatting', String(err));
  }

  // 4. AgentMemoryStore Contract Integration
  try {
    const store = new ProceduralMemoryStore();
    await store.savePlaybook({
      id: 'pb_contract',
      name: 'Incident Escalation',
      description: 'Escalate severe P0 outage to human on-call',
      triggers: ['outage', 'p0', 'incident'],
      steps: [{ stepNumber: 1, title: 'Page On-Call', description: 'Trigger PagerDuty alert' }],
    });

    const recalledRecords = await store.recall('outage');
    assert(recalledRecords.length === 1, 'recall() returns memory record');
    assert(recalledRecords[0].type === 'procedural', 'Record type is procedural');
    assert(recalledRecords[0].content.includes('Incident Escalation'), 'Formatted SOP content in memory record');
  } catch (err: unknown) {
    assert(false, 'AgentMemoryStore contract integration', String(err));
  }

  // 5. Delete and List
  try {
    const store = new ProceduralMemoryStore();
    await store.savePlaybook({
      id: 'pb_del',
      name: 'Temporary Procedure',
      description: 'Will be deleted',
      triggers: ['temp'],
      steps: [{ stepNumber: 1, title: 'Step 1', description: 'Action' }],
    });

    assert((await store.listPlaybooks()).length === 1, '1 playbook listed');
    const deleted = await store.deletePlaybook('pb_del');
    assert(deleted === true, 'Playbook deleted');
    assert((await store.listPlaybooks()).length === 0, '0 playbooks remaining after delete');
  } catch (err: unknown) {
    assert(false, 'Delete and list playbooks', String(err));
  }

  // 6. Prerequisite Filtering Satisfaction
  try {
    const store = new ProceduralMemoryStore();
    await store.savePlaybook({
      id: 'pb_admin_only',
      name: 'Admin Database Drop',
      description: 'Dangerous schema reset',
      triggers: ['admin_action', 'drop_db'],
      prerequisites: ['role:admin', 'tool:sql_drop'],
      steps: [{ stepNumber: 1, title: 'Drop Schema', description: 'Reset DB' }],
    });

    // Caller lacking required prerequisites
    const userMatches = await store.matchPlaybooks('admin_action', {
      availablePrerequisites: ['role:user'],
    });
    assert(
      userMatches.length === 0,
      'Prerequisite check filters out playbook when caller lacks required role (role:admin)',
    );

    // Caller having only partial prerequisites
    const partialMatches = await store.matchPlaybooks('admin_action', {
      availablePrerequisites: ['role:admin'],
    });
    assert(
      partialMatches.length === 0,
      'Prerequisite check filters out playbook when caller lacks one prerequisite (tool:sql_drop)',
    );

    // Caller having all required prerequisites
    const authorizedMatches = await store.matchPlaybooks('admin_action', {
      availablePrerequisites: ['role:admin', 'tool:sql_drop', 'other_cap'],
    });
    assert(
      authorizedMatches.length === 1,
      'Prerequisite check permits playbook when caller satisfies all prerequisites',
    );
  } catch (err: unknown) {
    assert(false, 'Prerequisite Filtering Satisfaction', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} Procedural memory test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} Procedural Memory & SOP Playbook tests passed successfully.\n`);
}
