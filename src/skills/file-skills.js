'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CHARS = 2800;
const DEFAULT_SECTION_CHARS = 120;

const SKILLS = {
  'project-run-check': {
    id: 'skill.project_run_check',
    title: 'project-run-check 文件化技能',
    path: 'skills/project-run-check.md',
    sections: [
      '适用场景',
      '输入材料',
      '允许操作',
      '禁止操作',
      '检查步骤',
      '证据要求',
      '完成标准',
      '失败处理',
      '输出格式',
    ],
  },
};

const FORBIDDEN_RUNTIME_PATTERNS = [
  /dist/i,
  /Sub-Agent/i,
  /MCP/,
  /sudo/i,
  /自动安装/,
  /Skill Engine/i,
  /Memory Runtime/i,
  /Vector DB/i,
];

function truncateText(text, maxChars) {
  const value = String(text || '').trim();
  if (!maxChars || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n...[truncated]`;
}

function isInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeSkillName(skillName) {
  const name = String(skillName || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new Error('Invalid file skill name');
  }
  if (!Object.prototype.hasOwnProperty.call(SKILLS, name)) {
    throw new Error('Unknown file skill');
  }
  return name;
}

function extractSection(markdown, sectionTitle) {
  const lines = String(markdown || '').split(/\r?\n/);
  const heading = `## ${sectionTitle}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function sanitizeRuntimeContent(content, warnings) {
  let output = String(content || '');
  FORBIDDEN_RUNTIME_PATTERNS.forEach((pattern) => {
    if (pattern.test(output)) {
      warnings.push('运行时技能摘要已过滤维护或高风险表述');
      const flags = pattern.ignoreCase ? 'gi' : 'g';
      output = output.replace(new RegExp(pattern.source, flags), '[filtered]');
    }
  });
  return output;
}

function buildSummary(markdown, skill, options, warnings) {
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : DEFAULT_MAX_CHARS;
  const sectionChars = Number(options.sectionChars) > 0
    ? Number(options.sectionChars)
    : DEFAULT_SECTION_CHARS;
  const parts = [
    `File skill: ${skill.id}`,
    `Path: ${skill.path}`,
    '',
  ];

  skill.sections.forEach((section) => {
    const body = extractSection(markdown, section);
    if (!body) {
      warnings.push(`文件化技能缺少章节: ${section}`);
      return;
    }
    parts.push(`## ${section}`);
    parts.push(truncateText(body, sectionChars));
    parts.push('');
  });

  return truncateText(sanitizeRuntimeContent(parts.join('\n').trim(), warnings), maxChars);
}

function loadSkillSummary(skillName, options) {
  options = options || {};
  const name = normalizeSkillName(skillName);
  const skill = SKILLS[name];
  const root = path.resolve(options.root || path.join(__dirname, '..', '..'));
  const skillsRoot = path.resolve(root, 'skills');
  const filePath = path.resolve(root, skill.path);
  const warnings = [];

  if (!isInside(skillsRoot, filePath)) {
    throw new Error('File skill path escapes skills directory');
  }
  if (path.extname(filePath).toLowerCase() !== '.md') {
    throw new Error('File skill must be a Markdown file');
  }

  const markdown = fs.readFileSync(filePath, 'utf8');
  const content = buildSummary(markdown, skill, options, warnings);

  return {
    id: skill.id,
    title: skill.title,
    path: skill.path,
    content,
    warnings: Array.from(new Set(warnings)),
  };
}

module.exports = {
  loadSkillSummary,
};
