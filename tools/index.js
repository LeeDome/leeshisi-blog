// 工具注册表：自动加载 tools/ 目录下所有工具模块并组装
//
// 新建工具约定（每个工具模块导出一个对象，字段如下）：
//   module.exports = {
//     name: '工具名',                        // 唯一、小写驼峰，AI 通过它调用
//     description: '工具介绍',                // 必须：用途说明，会注入 AI 上下文
//     parameters: { type:'object', ... },   // 参数 JSON Schema
//     run: async (context, args) => {...}   // 执行体；context 由调用方注入，args 为 AI 参数
//   };
// 新增工具只需在 tools/ 下新建一个 .js 文件，注册表会自动加载，无需改其他代码。

const fs = require('fs');
const path = require('path');

let _tools = null;

// 加载一次并缓存
function loadTools() {
  if (_tools) return _tools;
  const tools = [];
  const files = fs.readdirSync(__dirname).filter(function(f) {
    return f === 'index.js' ? false : /\.js$/.test(f);
  });
  files.forEach(function(file) {
    const Tool = require(path.join(__dirname, file));
    if (Tool && Tool.name && Tool.name !== 'index.js') {
      tools.push(Tool);
    }
  });
  _tools = tools;
  return tools;
}

// 返回所有工具对象
function getTools() {
  return loadTools();
}

// 构造发给 AI 的 function schema 定义数组
function getToolsDefinition() {
  return loadTools().map(function(t) {
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    };
  });
}

// 构造按名分发的执行器 { toolName: (args)=>run(context, args) }
function getToolExecutor(context) {
  const map = {};
  loadTools().forEach(function(t) {
    if (typeof t.run === 'function') {
      map[t.name] = function(args) { return t.run(context, args); };
    }
  });
  return map;
}

// 工具清单说明：拼接每个工具的"介绍"，注入 AI 系统上下文，让 AI 知道可调用哪些工具
function getToolsPrompt() {
  const tools = loadTools();
  if (!tools.length) return '';
  const lines = tools.map(function(t) {
    return '- ' + t.name + '：' + (t.description || '');
  });
  return '你可以使用的工具：\n' + lines.join('\n');
}

module.exports = {
  getTools,
  getToolsDefinition,
  getToolExecutor,
  getToolsPrompt
};