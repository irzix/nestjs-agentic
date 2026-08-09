import 'reflect-metadata';
import {
  Context,
  Param,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
} from '../src';
import type { AgentContext, DiscoveredTool, PolicyResult, ToolPolicy } from '../src';

// Dummy Policy Classes for Testing
class TestClassPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'allow' };
  }
}

class TestMethodPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'allow' };
  }
}

// 1. Valid Decorated ToolSet Class
@ToolSet({ name: 'search-tools', tags: ['search', 'database'] })
@UsePolicies(TestClassPolicy)
class SearchTools {
  @Tool({ name: 'executeSearch', description: 'Searches database for items' })
  @UsePolicies(TestMethodPolicy)
  async search(
    @Param('query', { description: 'Search term', type: 'string', required: true }) query: string,
    @Param('limit', { description: 'Max results', type: 'number', required: false }) limit: number,
    @Context() ctx: AgentContext,
  ) {
    return { query, limit, userId: ctx.security.userId };
  }

  @Tool({ description: 'Simple method without explicit tool name' })
  async simpleMethod(@Param('id') id: string) {
    return { id };
  }
}

// 2. Un-decorated Class
class UndecoratedClass {
  async search() {}
}

export async function runToolDiscoveryTests() {
  console.log('🔍 Running Step 1: ToolDiscoveryService Unit Tests...\n');
  const service = new ToolDiscoveryService();
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

  // TEST 1: Undecorated class returns null
  try {
    const res = service.discover(new UndecoratedClass());
    assert(res === null, 'Test 1: Undecorated class returns null');
  } catch (err: any) {
    assert(false, 'Test 1: Undecorated class returns null', err.message);
  }

  // TEST 2: ToolSet Options Discovery
  const instance = new SearchTools();
  const res = service.discover(instance);

  try {
    assert(res !== null, 'Test 2a: ToolSet discovered successfully');
    assert(res?.options.name === 'search-tools', 'Test 2b: ToolSet name matches "search-tools"');
    assert(
      Array.isArray(res?.options.tags) && res?.options.tags.includes('database'),
      'Test 2c: ToolSet tags discovered',
    );
  } catch (err: any) {
    assert(false, 'Test 2: ToolSet Options Discovery', err.message);
  }

  // TEST 3: Class-Level Policy Extraction
  try {
    const classPolicies = res?.classPolicyConstructors ?? [];
    assert(
      classPolicies.length === 1 && classPolicies[0] === TestClassPolicy,
      'Test 3: Class-level @UsePolicies extracted',
    );
  } catch (err: any) {
    assert(false, 'Test 3: Class-Level Policy Extraction', err.message);
  }

  // TEST 4: Tool Methods Extraction & Fallback
  try {
    const tools = res?.tools ?? [];
    assert(tools.length === 2, 'Test 4a: Discovered 2 @Tool methods');

    const searchTool = tools.find((t: DiscoveredTool) => t.methodName === 'search');
    const simpleTool = tools.find((t: DiscoveredTool) => t.methodName === 'simpleMethod');

    assert(
      searchTool?.toolName === 'executeSearch',
      'Test 4b: Custom tool name override "executeSearch" resolved',
    );
    assert(
      simpleTool?.toolName === 'simpleMethod',
      'Test 4c: Default fallback to method name "simpleMethod" resolved',
    );
  } catch (err: any) {
    assert(false, 'Test 4: Tool Methods Extraction', err.message);
  }

  // TEST 5: Parameter Schema & Context Index Discovery
  try {
    const searchTool = res?.tools.find((t: DiscoveredTool) => t.methodName === 'search');
    const params = searchTool?.params ?? [];

    assert(params.length === 2, 'Test 5a: Discovered 2 parameters for search tool');
    assert(params[0].name === 'query' && params[0].type === 'string', 'Test 5b: Parameter "query" metadata');
    assert(params[1].name === 'limit' && params[1].type === 'number', 'Test 5c: Parameter "limit" metadata');
    assert(searchTool?.contextParamIndex === 2, 'Test 5d: @Context parameter index correctly detected (index 2)');
  } catch (err: any) {
    assert(false, 'Test 5: Parameter Schema & Context Index', err.message);
  }

  // TEST 6: Method-Level Policy Extraction
  try {
    const searchTool = res?.tools.find((t: DiscoveredTool) => t.methodName === 'search');
    const methodPolicies = searchTool?.policyConstructors ?? [];

    assert(
      methodPolicies.length === 1 && methodPolicies[0] === TestMethodPolicy,
      'Test 6: Method-level @UsePolicies extracted for "search" tool',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Method-Level Policy Extraction', err.message);
  }

  console.log(`\n  📊 Step 1 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 1 Unit Tests Failed');
  }
}

// Run directly if executed via node
if (require.main === module) {
  runToolDiscoveryTests().catch(() => process.exit(1));
}
