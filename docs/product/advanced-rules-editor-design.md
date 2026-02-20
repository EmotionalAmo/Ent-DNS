# 高级规则编辑器前端设计

> UI/UX 实现方案与交互设计

---

## 1. 设计理念

### 1.1 渐进式披露

用户不需要了解所有功能就能使用。通过分层设计，按需展开复杂功能。

```
新手模式 → 进阶模式 → 专家模式
   ↓           ↓            ↓
  10%         30%          100%
```

### 1.2 认知负荷控制

- **单个页面不超过 7 个可交互元素**（Miller's Law）
- **使用视觉层级**引导用户注意力
- **即时反馈**减少用户记忆负担

---

## 2. 组件架构

### 2.1 组件树

```
AdvancedRulesPage
├── RuleList (规则列表)
│   ├── RuleCard (规则卡片)
│   ├── DragDropLayer (拖拽排序)
│   └── Pagination (分页)
├── RuleEditor (规则编辑器)
│   ├── ModeTabs (模式切换: 基础/进阶/专家)
│   ├── BasicEditor (基础编辑器)
│   ├── AdvancedEditor (进阶编辑器)
│   │   ├── DomainInput
│   │   ├── RegexInput
│   │   ├── ConditionBuilder
│   │   └── TimeSelector
│   └── ExpertEditor (专家编辑器)
│       └── MonacoEditor
├── RuleTestTool (规则测试工具)
├── TemplateLibrary (规则模板库)
└── RuleHistory (规则历史)
```

### 2.2 状态管理

```typescript
// stores/useRuleStore.ts
interface RuleStore {
  // 规则列表
  rules: AdvancedRule[];

  // 当前编辑的规则
  editingRule: AdvancedRule | null;

  // 编辑器模式
  editorMode: 'basic' | 'advanced' | 'expert';

  // 测试结果
  testResults: TestResult[];

  // UI 状态
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchRules: () => Promise<void>;
  createRule: (rule: CreateRuleRequest) => Promise<AdvancedRule>;
  updateRule: (id: string, rule: UpdateRuleRequest) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  reorderRules: (newOrder: string[]) => Promise<void>;
  testRule: (rule: AdvancedRule, testCases: TestCase[]) => Promise<TestResult[]>;
}
```

---

## 3. 规则列表

### 3.1 卡片式布局

```tsx
// components/RuleList.tsx
import { useRuleStore } from '../stores/useRuleStore';
import { RuleCard } from './RuleCard';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

export function RuleList() {
  const { rules, isLoading, error, reorderRules } = useRuleStore();

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const newOrder = reorderList(rules, active.id, over.id);
      await reorderRules(newOrder.map(r => r.id));
    }
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="rule-list">
      {/* 工具栏 */}
      <div className="rule-list-toolbar">
        <Button onClick={() => openEditor()}>新建规则</Button>
        <Button onClick={() => openTemplates()}>导入模板</Button>
        <SearchInput onSearch={handleSearch} />
        <FilterSelect onChange={handleFilter} />
      </div>

      {/* 规则卡片列表 */}
      <DndContext onDragEnd={handleDragEnd}>
        <SortableContext items={rules} strategy={verticalListSortingStrategy}>
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </SortableContext>
      </DndContext>

      {/* 分页 */}
      <Pagination />
    </div>
  );
}
```

### 3.2 规则卡片

```tsx
// components/RuleCard.tsx
export function RuleCard({ rule }: { rule: AdvancedRule }) {
  return (
    <div className="rule-card">
      {/* 头部: 状态 + 优先级 + 名称 */}
      <div className="rule-card-header">
        <div className="rule-status">
          {rule.is_enabled ? (
            <Badge variant="success">✅</Badge>
          ) : (
            <Badge variant="secondary">⏸️</Badge>
          )}
        </div>

        <div className="rule-priority">
          <Tooltip content={`优先级: ${rule.priority}`}>
            <Badge variant="outline">{rule.priority}</Badge>
          </Tooltip>
        </div>

        <div className="rule-name">
          <h3>{rule.name}</h3>
        </div>
      </div>

      {/* 内容: 规则详情 */}
      <div className="rule-card-content">
        <CodeBlock>
          {formatRuleDisplay(rule)}
        </CodeBlock>

        {rule.comment && (
          <div className="rule-comment">
            💬 {rule.comment}
          </div>
        )}

        <div className="rule-stats">
          <span>匹配次数: {formatNumber(rule.match_count)}</span>
          {rule.last_matched && (
            <span>最后匹配: {formatDate(rule.last_matched)}</span>
          )}
        </div>
      </div>

      {/* 底部: 操作按钮 */}
      <div className="rule-card-footer">
        <Button variant="ghost" size="sm" onClick={() => handleEdit(rule.id)}>
          编辑
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleToggle(rule)}>
          {rule.is_enabled ? '禁用' : '启用'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleDuplicate(rule.id)}>
          复制
        </Button>
        <Button variant="ghost" size="sm" danger onClick={() => handleDelete(rule.id)}>
          删除
        </Button>
      </div>
    </div>
  );
}
```

---

## 4. 规则编辑器

### 4.1 模式切换

```tsx
// components/RuleEditor.tsx
export function RuleEditor({ mode = 'basic' }: { mode?: 'basic' | 'advanced' | 'expert' }) {
  const [currentMode, setCurrentMode] = useState<'basic' | 'advanced' | 'expert'>(mode);

  return (
    <div className="rule-editor">
      {/* 模式切换 Tab */}
      <Tabs value={currentMode} onChange={setCurrentMode}>
        <TabsList>
          <TabsTrigger value="basic">基础模式</TabsTrigger>
          <TabsTrigger value="advanced">进阶模式</TabsTrigger>
          <TabsTrigger value="expert">专家模式</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <BasicEditor />
        </TabsContent>

        <TabsContent value="advanced">
          <AdvancedEditor />
        </TabsContent>

        <TabsContent value="expert">
          <ExpertEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### 4.2 基础编辑器

```tsx
// components/BasicEditor.tsx
export function BasicEditor() {
  const { createRule, editingRule } = useRuleStore();
  const [domain, setDomain] = useState('');
  const [action, setAction] = useState<'block' | 'allow'>('block');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    // 验证域名
    if (!isValidDomain(domain)) {
      setError('请输入有效的域名');
      return;
    }

    // 创建规则
    await createRule({
      name: domain,
      rule_type: 'domain',
      pattern: `||${domain}^`,
      action,
      is_enabled: true,
    });
  };

  return (
    <div className="basic-editor">
      <Input
        label="域名"
        placeholder="example.com"
        value={domain}
        onChange={setDomain}
        error={error}
      />

      <RadioGroup value={action} onChange={setAction}>
        <Radio value="block">阻断</Radio>
        <Radio value="allow">允许</Radio>
      </RadioGroup>

      <Button onClick={handleSubmit}>保存规则</Button>
      <Button variant="outline" onClick={() => switchToAdvanced()}>
        高级选项 ▼
      </Button>
    </div>
  );
}
```

### 4.3 进阶编辑器

```tsx
// components/AdvancedEditor.tsx
export function AdvancedEditor() {
  const [ruleType, setRuleType] = useState<'domain' | 'regex' | 'conditional'>('domain');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<'block' | 'allow' | 'rewrite'>('block');
  const [rewriteIp, setRewriteIp] = useState('');

  return (
    <div className="advanced-editor">
      {/* 规则类型选择 */}
      <TabGroup value={ruleType} onChange={setRuleType}>
        <TabList>
          <Tab value="domain">域名规则</Tab>
          <Tab value="regex">正则规则</Tab>
          <Tab value="conditional">条件规则</Tab>
        </TabList>
      </TabGroup>

      {/* 规则内容 */}
      {ruleType === 'domain' && (
        <DomainInput value={pattern} onChange={setPattern} />
      )}

      {ruleType === 'regex' && (
        <RegexInput value={pattern} onChange={setPattern} />
      )}

      {ruleType === 'conditional' && (
        <ConditionBuilder onChange={setConditions} />
      )}

      {/* 动作选择 */}
      <Select value={action} onChange={setAction}>
        <option value="block">阻断</option>
        <option value="allow">允许</option>
        <option value="rewrite">重写到</option>
      </Select>

      {action === 'rewrite' && (
        <Input
          label="目标 IP"
          placeholder="127.0.0.1"
          value={rewriteIp}
          onChange={setRewriteIp}
        />
      )}

      {/* 修饰符 */}
      <ModifierSection />

      {/* 按钮组 */}
      <div className="editor-actions">
        <Button onClick={handleSave}>保存规则</Button>
        <Button variant="outline" onClick={handleTest}>测试规则</Button>
        <Button variant="ghost" onClick={handleCancel}>取消</Button>
      </div>
    </div>
  );
}
```

### 4.4 正则输入

```tsx
// components/RegexInput.tsx
export function RegexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [testDomain, setTestDomain] = useState('');
  const [testResult, setTestResult] = useState<'match' | 'no-match' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTest = async () => {
    try {
      const regex = new RegExp(value, 'i');
      const matched = regex.test(testDomain);
      setTestResult(matched ? 'match' : 'no-match');
      setErrorMessage(null);
    } catch (e) {
      setTestResult('error');
      setErrorMessage(e.message);
    }
  };

  return (
    <div className="regex-input">
      <Input
        label="正则表达式"
        placeholder="/ads\./i"
        value={value}
        onChange={onChange}
        error={errorMessage}
      />

      {/* 测试区域 */}
      <div className="regex-test-area">
        <label>测试域名:</label>
        <Input
          placeholder="ads.example.com"
          value={testDomain}
          onChange={setTestDomain}
        />
        <Button onClick={handleTest}>测试</Button>

        {testResult && (
          <div className={`test-result test-result-${testResult}`}>
            {testResult === 'match' && '✓ 匹配'}
            {testResult === 'no-match' && '✗ 不匹配'}
            {testResult === 'error' && '✗ 正则错误'}
          </div>
        )}
      </div>

      {/* 正则提示 */}
      <div className="regex-tips">
        <h4>常用正则模式:</h4>
        <ul>
          <li><code>/ads\./i</code> - 包含 ads. (忽略大小写)</li>
          <li><code>/.*\.com$/</code> - .com 结尾</li>
          <li><code>/^ads\./</code> - ads. 开头</li>
        </ul>
      </div>
    </div>
  );
}
```

### 4.5 条件构建器

```tsx
// components/ConditionBuilder.tsx
export function ConditionBuilder({ onChange }: { onChange: (c: LogicalCondition) => void }) {
  const [operator, setOperator] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<Condition[]>([]);

  const addCondition = () => {
    setConditions([...conditions, {
      field: 'domain',
      operator: '=',
      value: '',
    }]);
  };

  return (
    <div className="condition-builder">
      {/* 条件列表 */}
      <div className="conditions-list">
        {conditions.map((cond, idx) => (
          <div key={idx} className="condition-row">
            <Select
              value={cond.field}
              onChange={(field) => updateCondition(idx, 'field', field)}
            >
              <option value="domain">域名</option>
              <option value="qtype">查询类型</option>
              <option value="client_ip">客户端 IP</option>
              <option value="time">时间</option>
            </Select>

            <Select
              value={cond.operator}
              onChange={(op) => updateCondition(idx, 'operator', op)}
            >
              <option value="=">等于</option>
              <option value="~">正则匹配</option>
              <option value="IN">在列表中</option>
            </Select>

            <Input
              value={cond.value}
              onChange={(v) => updateCondition(idx, 'value', v)}
              placeholder="值"
            />

            <Button variant="ghost" danger onClick={() => removeCondition(idx)}>
              删除
            </Button>
          </div>
        ))}
      </div>

      {/* 添加条件 */}
      <Button variant="outline" onClick={addCondition}>
        + 添加条件
      </Button>

      {/* 逻辑运算符 */}
      <RadioGroup value={operator} onChange={setOperator}>
        <Radio value="AND">AND（全部满足）</Radio>
        <Radio value="OR">OR（任一满足）</Radio>
      </RadioGroup>
    </div>
  );
}
```

---

## 5. 规则测试工具

### 5.1 测试界面

```tsx
// components/RuleTestTool.tsx
export function RuleTestTool({ rule }: { rule: AdvancedRule }) {
  const [testCases, setTestCases] = useState<TestCase[]>([
    { domain: '', qtype: 'A', client_ip: '', time: new Date().toISOString() },
  ]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleTest = async () => {
    setIsLoading(true);
    try {
      const data = await rulesApi.testRule(rule, testCases);
      setResults(data.results);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rule-test-tool">
      <h3>规则测试工具</h3>

      {/* 测试用例列表 */}
      <div className="test-cases">
        {testCases.map((testCase, idx) => (
          <div key={idx} className="test-case-row">
            <Input
              label="域名"
              placeholder="example.com"
              value={testCase.domain}
              onChange={(v) => updateTestCase(idx, 'domain', v)}
            />
            <Select
              value={testCase.qtype}
              onChange={(v) => updateTestCase(idx, 'qtype', v)}
            >
              <option value="A">A (IPv4)</option>
              <option value="AAAA">AAAA (IPv6)</option>
            </Select>
            <Input
              label="客户端 IP"
              placeholder="192.168.1.100"
              value={testCase.client_ip}
              onChange={(v) => updateTestCase(idx, 'client_ip', v)}
            />
          </div>
        ))}

        <Button variant="outline" onClick={addTestCase}>
          + 添加测试用例
        </Button>
      </div>

      {/* 运行测试 */}
      <div className="test-actions">
        <Button onClick={handleTest} loading={isLoading}>
          运行测试
        </Button>
      </div>

      {/* 测试结果 */}
      {results.length > 0 && (
        <div className="test-results">
          <h4>测试结果</h4>
          {results.map((result, idx) => (
            <div key={idx} className={`test-result test-result-${result.matched ? 'match' : 'no-match'}`}>
              <span className="test-domain">{result.domain}</span>
              <span className="test-action">
                {result.action.toUpperCase()}
              </span>
              {result.matched && (
                <Badge variant="success">✓ 匹配</Badge>
              )}
              {!result.matched && (
                <Badge variant="secondary">✗ 不匹配</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 6. 规则模板库

### 6.1 模板选择

```tsx
// components/TemplateLibrary.tsx
export function TemplateLibrary() {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTemplates = templates.filter(t => {
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="template-library">
      <h2>规则模板库</h2>

      {/* 搜索和过滤 */}
      <div className="template-filters">
        <Input
          placeholder="搜索模板..."
          value={searchTerm}
          onChange={setSearchTerm}
        />
        <Select value={selectedCategory} onChange={setSelectedCategory}>
          <option value="all">全部</option>
          <option value="ads">广告阻断</option>
          <option value="social">社交媒体</option>
          <option value="work">工作时间</option>
          <option value="family">家庭控制</option>
        </Select>
      </div>

      {/* 模板列表 */}
      <div className="template-grid">
        {filteredTemplates.map(template => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </div>
    </div>
  );
}
```

### 6.2 模板卡片

```tsx
// components/TemplateCard.tsx
export function TemplateCard({ template }: { template: RuleTemplate }) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleImport = async () => {
    await rulesApi.importTemplate(template.id);
  };

  return (
    <div className="template-card">
      <div className="template-header">
        <h3>{template.name}</h3>
        <Badge variant="outline">{template.category}</Badge>
      </div>

      <p className="template-description">{template.description}</p>

      <div className="template-rules-preview">
        {template.rules.slice(0, 3).map(rule => (
          <code key={rule.id}>{formatRule(rule)}</code>
        ))}
        {template.rules.length > 3 && (
          <span>+ {template.rules.length - 3} 更多规则</span>
        )}
      </div>

      <div className="template-actions">
        <Button variant="outline" onClick={() => setIsPreviewOpen(true)}>
          预览
        </Button>
        <Button onClick={handleImport}>导入</Button>
      </div>

      {/* 预览对话框 */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{template.name}</DialogTitle>
          </DialogHeader>
          <div className="template-preview-content">
            {template.rules.map(rule => (
              <CodeBlock key={rule.id}>{formatRule(rule)}</CodeBlock>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

## 7. 专家模式（DSL 编辑器）

### 7.1 Monaco Editor 集成

```tsx
// components/ExpertEditor.tsx
import Editor from '@monaco-editor/react';

export function ExpertEditor() {
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Diagnostic[]>([]);

  const handleEditorChange = (value: string | undefined) => {
    setCode(value || '');
    validateDSL(value || '');
  };

  const validateDSL = (code: string) => {
    const lines = code.split('\n');
    const newErrors: Diagnostic[] = [];

    lines.forEach((line, idx) => {
      try {
        parseRule(line);
      } catch (e) {
        newErrors.push({
          severity: 'error',
          message: e.message,
          startLineNumber: idx + 1,
          startColumn: 0,
          endLineNumber: idx + 1,
          endColumn: line.length,
        });
      }
    });

    setErrors(newErrors);
  };

  return (
    <div className="expert-editor">
      <Editor
        height="500px"
        language="dns-rule"
        value={code}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          rulers: [80],
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />

      {/* 错误列表 */}
      {errors.length > 0 && (
        <div className="editor-errors">
          <h4>语法错误:</h4>
          {errors.map((error, idx) => (
            <div key={idx} className="error-item">
              <Badge variant="danger">行 {error.startLineNumber}</Badge>
              <span>{error.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 模板提示 */}
      <div className="template-suggestions">
        <h4>常用模板:</h4>
        {templateSuggestions.map(template => (
          <Button
            key={template.id}
            variant="outline"
            size="sm"
            onClick={() => insertTemplate(template.code)}
          >
            {template.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

### 7.2 Monaco 自定义语言

```typescript
// monaco/dns-rule.ts
import * as monaco from 'monaco-editor';

monaco.languages.register({ id: 'dns-rule' });

// 关键字高亮
monaco.languages.setMonarchTokensProvider('dns-rule', {
  keywords: ['IF', 'THEN', 'AND', 'OR', 'NOT', 'IN'],
  operators: ['=', '~', '(', ')', ','],
  tokenizer: {
    root: [
      [/@@/, 'keyword'],
      [/\|\|/, 'keyword'],
      [/\//, 'delimiter'],
      [/\$/, 'keyword'],
      [/[a-z]+=/, 'type'],
      [/IF|THEN|AND|OR|NOT|IN/, 'keyword'],
      [/block|allow|rewrite/, 'string'],
      [/[0-9]+:[0-9]+/, 'number'],
      [/\[.*?\]/, 'string'],
      [/Mon|Tue|Wed|Thu|Fri|Sat|Sun/, 'string'],
    ],
  },
});

// 自动补全
monaco.languages.registerCompletionItemProvider('dns-rule', {
  provideCompletionItems: (model, position) => {
    const suggestions: monaco.languages.CompletionItem[] = [
      {
        label: 'IF ... THEN ...',
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: 'IF ${1:domain}=${2:value} THEN ${3:block}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      },
      {
        label: 'Time modifier',
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: '$time=${1:22:00}-${2:06:00}',
      },
      {
        label: 'Days modifier',
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: '$days=[${1:Mon,Tue,Wed,Thu,Fri}]',
      },
    ];
    return { suggestions };
  },
});
```

---

## 8. 拖拽排序

```tsx
// components/SortableRuleCard.tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function SortableRuleCard({ rule }: { rule: AdvancedRule }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <RuleCard rule={rule} />
    </div>
  );
}
```

---

## 9. 样式设计

### 9.1 Tailwind 配置

```css
/* globals.css */
@layer components {
  .rule-card {
    @apply bg-white border border-gray-200 rounded-lg p-4 shadow-sm transition-shadow;
    &:hover {
      @apply shadow-md;
    }
  }

  .rule-card-header {
    @apply flex items-center gap-3 mb-3;
  }

  .rule-name h3 {
    @apply text-sm font-semibold text-gray-900;
  }

  .rule-card-content {
    @apply space-y-2 mb-3;
  }

  .rule-stats {
    @apply text-xs text-gray-500 flex gap-4;
  }

  .rule-card-footer {
    @apply flex gap-2 pt-3 border-t border-gray-200;
  }

  .test-result-match {
    @apply text-green-600;
  }

  .test-result-no-match {
    @apply text-gray-500;
  }

  .test-result-error {
    @apply text-red-600;
  }
}
```

### 9.2 暗色主题

```typescript
// themes/dark.ts
export const darkTheme = {
  ruleCard: {
    background: '#1f2937',
    border: '#374151',
    text: '#f9fafb',
  },
  button: {
    primary: '#3b82f6',
    danger: '#ef4444',
  },
  codeBlock: {
    background: '#111827',
    text: '#e5e7eb',
  },
};
```

---

## 10. 响应式设计

### 10.1 移动端适配

```tsx
// breakpoints: sm (640px), md (768px), lg (1024px)

export function ResponsiveRuleList() {
  return (
    <div className="rule-list">
      {/* 桌面端: 卡片列表 */}
      <div className="hidden md:block md:grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rules.map(rule => (
          <RuleCard key={rule.id} rule={rule} />
        ))}
      </div>

      {/* 移动端: 折叠列表 */}
      <div className="md:hidden space-y-2">
        {rules.map(rule => (
          <CollapsibleRuleCard key={rule.id} rule={rule} />
        ))}
      </div>
    </div>
  );
}
```

---

## 11. 可访问性（A11y）

### 11.1 ARIA 标签

```tsx
export function AccessibleRuleCard({ rule }: { rule: AdvancedRule }) {
  return (
    <div
      role="article"
      aria-label={`规则: ${rule.name}`}
      aria-describedby={`rule-desc-${rule.id}`}
    >
      <h3>{rule.name}</h3>
      <p id={`rule-desc-${rule.id}`}>
        {formatRule(rule)}
      </p>

      <button
        aria-label="编辑规则"
        onClick={handleEdit}
      >
        编辑
      </button>

      <button
        aria-label={`切换规则状态，当前${rule.is_enabled ? '启用' : '禁用'}`}
        onClick={handleToggle}
      >
        {rule.is_enabled ? '禁用' : '启用'}
      </button>
    </div>
  );
}
```

### 11.2 键盘导航

```tsx
export function KeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeEditor();
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveRule();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div>
      <button onClick={saveRule} title="保存 (Ctrl+S)">保存</button>
      <button onClick={closeEditor} title="关闭 (Esc)">关闭</button>
    </div>
  );
}
```

---

## 12. 性能优化

### 12.1 虚拟滚动

```tsx
// components/VirtualRuleList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export function VirtualRuleList({ rules }: { rules: AdvancedRule[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rules.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 150, // 估算高度
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <RuleCard rule={rules[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 12.2 防抖和节流

```typescript
// hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// 使用示例
export function RuleSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    searchRules(debouncedSearchTerm);
  }, [debouncedSearchTerm]);

  return (
    <Input value={searchTerm} onChange={setSearchTerm} />
  );
}
```

---

## 13. 测试策略

### 13.1 组件测试

```typescript
// __tests__/RuleCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleCard } from '../components/RuleCard';

describe('RuleCard', () => {
  const mockRule = {
    id: '1',
    name: '阻断广告',
    rule_type: 'regex',
    pattern: '/ads\\./i',
    action: 'block',
    is_enabled: true,
    priority: 100,
    match_count: 1234,
    last_matched: '2026-02-20T10:00:00Z',
  };

  it('renders rule name', () => {
    render(<RuleCard rule={mockRule} />);
    expect(screen.getByText('阻断广告')).toBeInTheDocument();
  });

  it('shows enabled status', () => {
    render(<RuleCard rule={mockRule} />);
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('calls onEdit when edit button clicked', () => {
    const onEdit = jest.fn();
    render(<RuleCard rule={mockRule} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('编辑'));
    expect(onEdit).toHaveBeenCalledWith('1');
  });
});
```

### 13.2 E2E 测试

```typescript
// e2e/rule-editor.spec.ts
import { test, expect } from '@playwright/test';

test('create new rule', async ({ page }) => {
  await page.goto('/rules');

  // 点击新建规则
  await page.click('text=新建规则');

  // 输入域名
  await page.fill('input[placeholder="example.com"]', 'ads.com');

  // 选择阻断
  await page.click('input[value="block"]');

  // 点击保存
  await page.click('text=保存规则');

  // 验证规则已创建
  await expect(page.locator('text=ads.com')).toBeVisible();
});

test('test regex rule', async ({ page }) => {
  await page.goto('/rules');

  // 切换到进阶模式
  await page.click('text=进阶模式');

  // 选择正则规则
  await page.click('text=正则规则');

  // 输入正则
  await page.fill('input[placeholder="/ads\\./i"]', '/ads\\./i');

  // 测试域名
  await page.fill('input[placeholder="ads.example.com"]', 'ads.example.com');
  await page.click('text=测试');

  // 验证匹配结果
  await expect(page.locator('text=✓ 匹配')).toBeVisible();
});
```

---

## 14. 下一步行动

1. **原型开发** — 创建 Figma 原型，收集用户反馈
2. **组件开发** — 按优先级实现核心组件
3. **用户测试** — 邀请真实用户测试易用性
4. **性能优化** — 虚拟滚动、防抖节流
5. **可访问性** — ARIA 标签、键盘导航

---

**文档版本**: 1.0
**最后更新**: 2026-02-20
